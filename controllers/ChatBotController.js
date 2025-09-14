// controllers/ChatBotController.js
import OpenAI from "openai";
import Product from '../models/ProductModel.js';
import Order from '../models/OrderModel.js';
import User from '../models/UserModel.js';
import Cart from '../models/CartModel.js'; // <<-- assume your cart model is here
import mongoose from 'mongoose';

// Initialize OpenAI (still used for non-essential/natural-language flows)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_INSTRUCTION = `
You are ShopBot, a helpful and friendly e-commerce customer support assistant for "MS Trendzz".
Your primary goal is to assist users with:
1. Order Tracking
2. Displaying User's Orders
3. Abandoned Cart Recovery
4. Product Details & Reviews
5. General FAQs
6. Handover to Human Support

Rules:
- Stay on topic (orders, products, shop services).
- If outside scope, say: "I'm sorry, I can only assist with inquiries related to MyAwesomeShop's products, orders, and services. For other questions, please contact our human support team at loyaltymethods@gmail.com or call us at 8523051130."
- Keep responses concise & clear.
`;

// Redact address (show last 2 parts only)
function redactAddress(addr = '') {
  if (!addr || typeof addr !== 'string') return 'Redacted';
  const parts = addr.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return 'Redacted';
  const last = parts.slice(-2).join(', ');
  return `${last} (full address redacted)`;
}

// Format number as Indian Rupees (₹)
function formatINR(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '₹0.00';
  try {
    return Number(value).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
  } catch (e) {
    // Fallback simple formatting
    return `${Number(value).toFixed(2)}`;
  }
}

// Convert any $<number> occurrences in free text to INR formatted values
function convertDollarAmountsToINR(text) {
  if (!text || typeof text !== 'string') return text;
  // matches $1,234.56 or $1234 or $1234.5 etc.
  return text.replace(/\$([0-9]{1}[0-9,]*\.?[0-9]*)/g, (_, numStr) => {
    const normalized = Number(numStr.replace(/,/g, ''));
    if (Number.isNaN(normalized)) return formatINR(0);
    return formatINR(normalized);
  });
}

// Safe wrapper used before sending reply to frontend
function safeReplyText(text) {
  if (typeof text !== 'string') return text;
  return convertDollarAmountsToINR(text);
}

// Build short order context (PII redacted) — used for OpenAI prompts when needed
function buildOrderContext(order) {
  if (!order) return '';
  const itemDetails = (order.items || []).map(item => `${item.title} (₹${item.price})`).join(', ') || 'No items listed';
  const shipping = redactAddress(order.shippingAddress);
  const totalStr = order.totalAmount != null ? formatINR(order.totalAmount) : 'unknown';
  return `Order #${order._id || order.orderNumber || 'unknown'}:
- Items: ${itemDetails}
- Status: ${order.status || 'unknown'}
- Total Amount: ${totalStr}
- Ordered At: ${order.orderDate ? new Date(order.orderDate).toLocaleString('en-IN') : 'unknown'}
- Delivery Location: ${shipping}`;
}

const isDev = process.env.NODE_ENV !== 'production';

// Simple retry wrapper for OpenAI calls
async function openaiWithRetry(payload, retries = 1) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      // Using chat completions interface
      return await openai.chat.completions.create(payload);
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise(r => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

// Local mapping of order status -> short helpful next steps
function localOrderStatusReply(order) {
  const status = (order.status || 'unknown').toLowerCase();

  // Base line
  let reply = `Current order status: ${order.status || 'Unknown'}.`;

  // Add status-specific guidance
  if (status.includes('shipped') || status.includes('out for delivery') || status.includes('in transit')) {
    const eta = order.estimatedDeliveryDate ? ` Estimated delivery: ${new Date(order.estimatedDeliveryDate).toLocaleDateString('en-IN')}.` : '';
    reply += ` Your package is on the way.${eta} You can track with tracking number ${order.trackingNumber || 'N/A'}.`;
  } else if (status.includes('processing') || status.includes('confirmed') || status.includes('pending')) {
    reply += ` Your order is being processed. We'll notify you when it ships.`;
  } else if (status.includes('delivered')) {
    reply += ` It shows delivered. If you didn't receive it, reply "missing delivery" or contact support@myawesomeshop.com.`;
  } else if (status.includes('cancel') || status.includes('cancelled') || status.includes('canceled')) {
    reply += ` This order was cancelled. If you think that's a mistake, reply "dispute" or contact support@myawesomeshop.com.`;
  } else if (status.includes('refund') || status.includes('refunded')) {
    reply += ` This order has been refunded. If you have questions about the refund timing, contact support@myawesomeshop.com.`;
  } else if (status.includes('returned')) {
    reply += ` The items have been returned. If you need more details about the refund, contact support@myawesomeshop.com.`;
  } else {
    reply += ` For more details, contact support@myawesomeshop.com or reply with more questions.`;
  }

  // Short privacy-safe info
  const shipping = redactAddress(order.shippingAddress);
  const totalStr = order.totalAmount != null ? formatINR(order.totalAmount) : 'unknown';
  reply += `\n\nOrder summary: ${(order.items || []).map(i => i.title).slice(0,3).join(', ') || 'No items listed'} — Total: ${totalStr} — Delivery location: ${shipping}`;

  return reply;
}

// Local cart summary reply generator (deterministic, no OpenAI)
function localCartReply(cartItems = []) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return {
      text: "Your cart is empty. Browse our products and add items to your cart. If you need help, ask me!",
      cart: []
    };
  }

  const cart = cartItems.map((it, idx) => {
    // Accept multiple shapes: { productId, qty, title, price } or { product: {...}, quantity }
    let productId = it.productId || (it.product && (it.product._id || it.product.id)) || it._id || null;
    let title = it.title || (it.product && (it.product.title || it.product.name)) || 'Unknown product';
    let price = typeof it.price === 'number' ? it.price : (it.product && typeof it.product.price === 'number' ? it.product.price : null);
    let qty = it.qty ?? it.quantity ?? 1;
    const lineTotal = (price != null) ? (price * qty) : null;

    return {
      idx: idx + 1,
      id: productId ? String(productId) : null,
      title,
      price,
      qty,
      lineTotal
    };
  });

  const subtotal = cart.reduce((s, c) => s + (c.lineTotal ?? 0), 0);
  const textLines = cart.map(c => `• ${c.title} — ${c.qty} × ${c.price != null ? formatINR(c.price) : 'N/A'}${c.lineTotal != null ? ` = ${formatINR(c.lineTotal)}` : ''}`);
  const text = `You have ${cart.length} item(s) in your cart:\n\n${textLines.join('\n')}\n\nSubtotal: ${formatINR(subtotal)}. Reply "checkout" to proceed or "remove <index>" to remove an item.`;

  return { text, cart, subtotal };
}

/* analyzeMessageWithOpenAI (unchanged) */
async function analyzeMessageWithOpenAI(rawMessage, userId = null) {
  const systemPrompt = `
You are a lightweight intent and entity extractor for ShopBot. 
Given a single user message, return a JSON object (ONLY JSON) with keys:
- intent: one of [track_order, cart, recent_orders, remove_item, checkout, greeting, returns, shipping, payments, select_order, openai_answer, unknown]
- orderId: string or null (if user mentioned an order / tracking id)
- index: integer or null (if user selected an index e.g., "1" or "remove 2")
- action: short verb like "remove", "checkout", null if none
- confidence: 0.0 - 1.0 number estimating your confidence
- text: brief normalized intent text for logging

If multiple candidates exist, return the most-likely. Do NOT include any extra text or commentary. Example:
{"intent":"track_order","orderId":"ABC123","index":null,"action":null,"confidence":0.95,"text":"track order ABC123"}
`;

  const userPrompt = `User message: """${rawMessage.replace(/\"/g, '\\"')}"""`;

  try {
    const completion = await openaiWithRetry({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.0,
      max_tokens: 180
    }, 1);

    const raw = completion?.choices?.[0]?.message?.content || '';
    // Try to extract JSON from the response robustly
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : raw;
    const parsed = JSON.parse(jsonString);
    return parsed;
  } catch (err) {
    console.error("[ChatBot] analyzeMessageWithOpenAI failed:", err && (err.message || err));
    // Fallback heuristic simple parser
    const text = rawMessage.toLowerCase();
    const isGreeting = /^(hi|hello|hey|good morning|good afternoon)/i.test(rawMessage);
    const orderIdMatch = rawMessage.match(/([A-Za-z0-9\-\_]{4,})/);
    // naive index detection
    const idxMatch = rawMessage.trim().match(/^(\d{1,2})$/) || rawMessage.match(/remove\s+(\d{1,2})/i);

    return {
      intent: isGreeting ? 'greeting' : (text.includes('cart') ? 'cart' : (text.includes('track') ? 'track_order' : 'openai_answer')),
      orderId: orderIdMatch ? orderIdMatch[1] : null,
      index: idxMatch ? parseInt(idxMatch[1], 10) : null,
      action: text.includes('remove') ? 'remove' : (text.includes('checkout') ? 'checkout' : null),
      confidence: 0.4,
      text: rawMessage.slice(0, 200)
    };
  }
}

export const replyChatBot = async (req, res) => {
  const { message, userId: incomingUserId } = req.body;
  const authHeader = (req.headers.authorization || req.body.token || '').toString();

  console.log("[ChatBot] request:", {
    path: req.path,
    messagePreview: typeof message === 'string' ? `${message.slice(0,120)}${message.length>120 ? '…' : ''}` : null,
    hasAuth: Boolean(authHeader),
    time: new Date().toISOString()
  });

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ message: "Please provide a message" });
  }

  const rawMessage = message.trim();
  const inputMessage = rawMessage.toLowerCase();

  let botReply = "";
  let intent = "general";
  let contextProvided = false;

  try {
    // Run quick deterministic checks (fast branch for trivial FAQs)
    if (inputMessage.includes("return policy") || inputMessage.includes("returns")) {
      intent = "returns";
      botReply = "Our return policy allows returns within 30 days of purchase for a full refund. Some exclusions may apply to sale or digital items. For specifics, see the product page or contact support@myawesomeshop.com.";
      return res.status(200).json({ reply: safeReplyText(botReply), intent, contextProvided: false });
    }

    if (inputMessage.includes("shipping cost") || inputMessage.includes("shipping costs") || inputMessage.includes("shipping")) {
      intent = "shipping";
      botReply = "Standard shipping is free on orders over ₹500. Exact costs are shown at checkout based on your address and selected shipping speed.";
      return res.status(200).json({ reply: safeReplyText(botReply), intent, contextProvided: false });
    }

    if (inputMessage.includes("payment methods") || inputMessage.includes("payment")) {
      intent = "payments";
      botReply = "We accept Visa, MasterCard, Amex, Discover, PayPal, and Google Pay.";
      return res.status(200).json({ reply: safeReplyText(botReply), intent, contextProvided: false });
    }

    // Use OpenAI to analyze the message and extract intent/entities
    let analysis = null;
    try {
      analysis = await analyzeMessageWithOpenAI(rawMessage, incomingUserId);
      // ensure shape
      analysis = analysis || {};
    } catch (anaErr) {
      console.error("[ChatBot] analysis error (ignored):", anaErr);
      analysis = null;
    }

    // If analysis exists, use it to set the intent variable
    if (analysis && analysis.intent) {
      intent = analysis.intent;
    } else {
      // fallback simple heuristics
      if (inputMessage.includes("cart") || inputMessage === "cart" || inputMessage.includes("show cart")) intent = "cart";
      else if (inputMessage.includes("track")) intent = "track_order";
      else if (inputMessage.includes("recent orders") || inputMessage.includes("my order") || inputMessage.includes("recent purchases")) intent = "recent_orders";
      else if (["hello", "hi", "hey"].includes(inputMessage) || inputMessage.startsWith("hello") || inputMessage.startsWith("hi")) intent = "greeting";
      else intent = "openai_answer";
    }

    // SPECIAL CASE: CART flow — read Cart collection by userId first
    if (intent === "cart") {
      if (!incomingUserId) {
        botReply = "To view your cart please log in to your account on our website.";
        return res.status(200).json({ reply: safeReplyText(botReply), intent, contextProvided: false });
      }

      // Try to find cart document in Cart collection by userId
      let cartDoc = null;
      try {
        const query = mongoose.Types.ObjectId.isValid(incomingUserId) ? { userId: incomingUserId } : { userId: incomingUserId };
        cartDoc = await Cart.findOne(query).lean();
      } catch (dbErr) {
        console.error("[ChatBot] DB error fetching cart document:", dbErr);
      }

      // If no Cart doc, try fallback to user.cart
      let cartItemsRaw = [];
      if (cartDoc) {
        if (Array.isArray(cartDoc.items) && cartDoc.items.length) {
          cartItemsRaw = cartDoc.items;
        } else if (Array.isArray(cartDoc.cart) && cartDoc.cart.length) {
          cartItemsRaw = cartDoc.cart;
        } else if (Array.isArray(cartDoc.products) && cartDoc.products.length) {
          cartItemsRaw = cartDoc.products;
        } else {
          const arrField = Object.keys(cartDoc).find(k => Array.isArray(cartDoc[k]));
          if (arrField) cartItemsRaw = cartDoc[arrField];
        }
      } else {
        let user = null;
        try {
          user = await User.findById(incomingUserId).lean();
        } catch (dbErr) {
          console.error("[ChatBot] DB error fetching user for cart fallback:", dbErr);
        }
        if (user) {
          if (Array.isArray(user.cart) && user.cart.length) cartItemsRaw = user.cart;
          else if (user.cart && Array.isArray(user.cart.items) && user.cart.items.length) cartItemsRaw = user.cart.items;
          else if (Array.isArray(user.currentCart) && user.currentCart.length) cartItemsRaw = user.currentCart;
          else if (user.basket && Array.isArray(user.basket.items)) cartItemsRaw = user.basket.items;
        }
      }

      cartItemsRaw = (cartItemsRaw || []).map(ci => {
        if (typeof ci === 'string') return { productId: ci, qty: 1 };
        return ci;
      });

      const normalizedCart = await Promise.all(cartItemsRaw.map(async (ci) => {
        try {
          if (ci.title || ci.product) {
            return {
              productId: ci.productId || (ci.product && (ci.product._id || ci.product.id)) || null,
              title: ci.title || (ci.product && (ci.product.title || ci.product.name)) || 'Unknown product',
              price: typeof ci.price === 'number' ? ci.price : (ci.product && typeof ci.product.price === 'number' ? ci.product.price : null),
              qty: ci.qty ?? ci.quantity ?? 1
            };
          }

          const pid = ci.productId || ci.product || ci._id || ci.product_id;
          if (!pid) {
            return { productId: null, title: ci.title || 'Unknown product', price: ci.price ?? null, qty: ci.qty ?? ci.quantity ?? 1 };
          }

          const pidStr = typeof pid === 'object' && (pid._id || pid.id) ? String(pid._id || pid.id) : String(pid);

          let prod = null;
          try {
            if (pidStr.match(/^[0-9a-fA-F]{24}$/)) {
              prod = await Product.findById(pidStr).lean();
            } else {
              prod = await Product.findOne({ $or: [{ sku: pidStr }, { slug: pidStr }, { productNumber: pidStr }] }).lean();
            }
          } catch (fetchErr) {
            console.error("[ChatBot] DB error populating cart product for pid:", pidStr, fetchErr);
          }

          if (prod) {
            return {
              productId: String(prod._id),
              title: prod.title || prod.name || 'Unnamed product',
              price: typeof prod.price === 'number' ? prod.price : null,
              qty: ci.qty ?? ci.quantity ?? 1
            };
          }

          return {
            productId: pidStr,
            title: ci.title || 'Unknown product',
            price: ci.price ?? null,
            qty: ci.qty ?? ci.quantity ?? 1
          };
        } catch (err) {
          console.error("[ChatBot] Unexpected normalization error:", err);
          return { productId: null, title: ci.title || 'Unknown product', price: ci.price ?? null, qty: ci.qty ?? 1 };
        }
      }));

      const { text, cart, subtotal } = localCartReply(normalizedCart);
      const rawCartDebug = cartDoc ? (cartDoc.items || cartDoc.cart || cartDoc.products || cartDoc) : (Array.isArray(cartItemsRaw) ? cartItemsRaw : []);

      return res.status(200).json({
        reply: safeReplyText(text),
        intent,
        contextProvided: true,
        rawCart: rawCartDebug,
        cart,
        subtotal: typeof subtotal === 'number' ? subtotal : undefined
      });
    }

    // TRACK ORDER flow
    if (intent === "track_order" || intent === "select_order") {
      // If analysis found an orderId, try that first
      const orderIdCandidate = (analysis && analysis.orderId) || rawMessage.match(/(?:track order|order id|order|order#|order #|tracking|tracking number)\s*[:#]?\s*([A-Za-z0-9\-\_]{4,})/i)?.[1];

      if (orderIdCandidate) {
        let order = null;
        try {
          if (mongoose.Types.ObjectId.isValid(orderIdCandidate)) {
            order = await Order.findById(orderIdCandidate).lean();
          }
          if (!order) {
            order = await Order.findOne({
              $or: [
                { orderNumber: orderIdCandidate },
                { trackingNumber: orderIdCandidate },
                { 'meta.shortId': orderIdCandidate }
              ]
            }).lean();
          }
        } catch (dbErr) {
          console.error("[ChatBot] DB error during order lookup:", dbErr);
        }

        if (!order) {
          botReply = `I couldn't find an order with ID/tracking "${orderIdCandidate}". Please double-check the ID or, if you're logged in, I can show your recent orders to select from.`;
          return res.status(200).json({ reply: safeReplyText(botReply), intent: "track_order", contextProvided: false });
        }

        const localReply = localOrderStatusReply(order);
        contextProvided = true;
        return res.status(200).json({ reply: safeReplyText(localReply), intent: "track_order", contextProvided });
      }

      // If user asked to select an order by index or numeric selection
      const numericSelection = (analysis && analysis.index) || rawMessage.trim().match(/^(\d{1,2})$/)?.[1];

      if (!incomingUserId) {
        botReply = "Please provide your order ID (e.g., 'Order #12345ABC') or log in so I can show your recent orders to select from.";
        return res.status(200).json({ reply: safeReplyText(botReply), intent: "track_order", contextProvided: false });
      }

      let userOrders = [];
      try {
        userOrders = await Order.find({ userId: incomingUserId }).sort({ orderDate: -1 }).limit(10).lean();
      } catch (dbErr) {
        console.error("[ChatBot] DB error fetching user orders for selection:", dbErr);
      }

      if (!userOrders || userOrders.length === 0) {
        botReply = "I couldn't find any recent orders under your account. If you think this is a mistake, please check your account page or contact support@myawesomeshop.com.";
        return res.status(200).json({ reply: safeReplyText(botReply), intent: "track_order", contextProvided: false });
      }

      if (numericSelection) {
        const idx = parseInt(numericSelection, 10) - 1;
        if (idx >= 0 && idx < userOrders.length) {
          const order = userOrders[idx];
          const localReply = localOrderStatusReply(order);
          contextProvided = true;
          return res.status(200).json({ reply: safeReplyText(localReply), intent: "track_order", contextProvided });
        } else {
          botReply = `I don't have an order at position ${numericSelection}. I found ${userOrders.length} recent orders. Please reply with the correct index (1-${userOrders.length}) or an order id.`;
          return res.status(200).json({ reply: safeReplyText(botReply), intent: "track_order", contextProvided: false });
        }
      }

      // Otherwise show recent orders so the user can choose
      const ordersSummary = userOrders.map(o => {
        const items = (o.items || []).map(i => i.title).slice(0,3).join(', ') || 'No items';
        const shortDate = o.orderDate ? new Date(o.orderDate).toLocaleDateString('en-IN') : 'Unknown date';
        return {
          id: String(o._id),
          orderNumber: o.orderNumber || null,
          status: o.status || 'unknown',
          itemsSummary: items,
          totalAmount: o.totalAmount ?? 0,
          orderedAt: shortDate
        };
      });

      botReply = "I found the following recent orders. Which one would you like me to track? Reply with the index (e.g., '1') or the order id.";
      const textualList = ordersSummary.map((s, idx) => `${idx + 1}. ${s.itemsSummary} — ${s.status} — ${formatINR(s.totalAmount)} — ${s.orderedAt} (id: ${s.id})`).join('\n');

      return res.status(200).json({
        reply: safeReplyText(`${botReply}\n\n${textualList}`),
        intent: "select_order",
        contextProvided: false,
        orders: ordersSummary
      });
    }

    // RECENT ORDERS flow
    if (intent === "recent_orders") {
      if (!incomingUserId) {
        botReply = "To view your orders, please log in to your account on our website.";
        return res.status(200).json({ reply: safeReplyText(botReply), intent, contextProvided: false });
      }

      let userOrders = [];
      try {
        userOrders = await Order.find({ userId: incomingUserId }).sort({ orderDate: -1 }).limit(5).lean();
      } catch (dbErr) {
        console.error("[ChatBot] DB error fetching user orders:", dbErr);
      }

      if (!userOrders || userOrders.length === 0) {
        botReply = "You don't seem to have any recent orders. If you think this is an error, please contact support@myawesomeshop.com.";
        return res.status(200).json({ reply: safeReplyText(botReply), intent, contextProvided: false });
      }

      const summary = userOrders.map(o => {
        const items = (o.items || []).map(i => i.title).join(', ') || 'No items';
        return `• ${items} — ${o.status || 'status unknown'} — ${formatINR(o.totalAmount ?? 0)} — ${new Date(o.orderDate).toLocaleDateString('en-IN')} — id: ${String(o._id)}`;
      }).join('\n');

      // Ask OpenAI to format a concise response (optional). If it fails, fallback to local summary.
      const prompt = `${SYSTEM_INSTRUCTION}\n\nRelevant context (user recent orders, PII redacted):\n${summary}\n\nUser's message: ${rawMessage}\n\nPlease respond concisely, e.g., list the recent orders and next steps (tracking, contact support) or ask clarifying questions.`;

      try {
        const messages = [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: prompt }
        ];

        const completion = await openaiWithRetry({
          model: 'gpt-4o-mini',
          messages,
          temperature: 0.12,
          max_tokens: 400
        }, 1);

        botReply = completion?.choices?.[0]?.message?.content?.trim() || "I couldn't format your recent orders at the moment. Please check your account page.";
        contextProvided = true;
        return res.status(200).json({ reply: safeReplyText(botReply), intent, contextProvided, orders: userOrders.map(o => ({
          id: String(o._id),
          items: (o.items || []).map(i => i.title).slice(0,3).join(', '),
          status: o.status || 'unknown',
          totalAmount: o.totalAmount ?? 0,
          orderedAt: o.orderDate ? new Date(o.orderDate).toLocaleDateString('en-IN') : 'unknown'
        })) });
      } catch (openAiErr) {
        console.error("[ChatBot] OpenAI error (recent orders):", openAiErr);
        const fallbackSummary = userOrders.map(o => {
          const items = (o.items || []).map(i => i.title).join(', ') || 'No items';
          return `• ${items} — ${o.status || 'status unknown'} — ${formatINR(o.totalAmount ?? 0)} — ${o.orderDate ? new Date(o.orderDate).toLocaleDateString('en-IN') : 'unknown'} — id: ${String(o._id)}`;
        }).join('\n');
        return res.status(200).json({
          reply: safeReplyText(`Here are your recent orders:\n\n${fallbackSummary}`),
          intent,
          contextProvided: true,
          orders: userOrders.map(o => ({
            id: String(o._id),
            itemsSummary: (o.items || []).map(i => i.title).slice(0,3).join(', '),
            status: o.status || 'unknown',
            totalAmount: o.totalAmount ?? 0,
            orderedAt: o.orderDate ? new Date(o.orderDate).toLocaleDateString('en-IN') : 'unknown'
          }))
        });
      }
    }

    // If we get here: either openai_answer intent or unknown -> use OpenAI to craft safe answer
    intent = intent || "openai_answer";
    const prompt = `\n${SYSTEM_INSTRUCTION}\n\nUser's message: ${rawMessage}\n\nPlease answer the user's question as best as you can but remain within the shop domain. If the question is outside MyAwesomeShop's scope, reply with the short scope-referral message.\n`;

    try {
      const messages = [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        { role: 'user', content: prompt }
      ];
      const completion = await openaiWithRetry({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.25,
        max_tokens: 350
      }, 1);

      botReply = completion?.choices?.[0]?.message?.content?.trim() || "Sorry — I couldn't generate a response right now. Please try again or contact support.";
      return res.status(200).json({ reply: safeReplyText(botReply), intent, contextProvided: false });
    } catch (openAiErr) {
      console.error("[ChatBot] OpenAI error (fallback):", openAiErr);
      const fallback = "Sorry — I couldn't generate a smart reply right now. Please try again or contact support@myawesomeshop.com.";
      if (isDev) {
        return res.status(200).json({ reply: safeReplyText(fallback), intent, contextProvided: false, _debugOpenAIError: String(openAiErr) });
      }
      return res.status(200).json({ reply: safeReplyText(fallback), intent, contextProvided: false });
    }
  } catch (error) {
    console.error("[ChatBot] Unhandled error:", error && (error.stack || error.message || error));
    const publicMsg = 'An error occurred during chatbot response. Please try again later or contact support.';
    const resp = { message: publicMsg };
    if (isDev) {
      resp.debug = {
        message: error?.message,
        stack: error?.stack ? error.stack.split('\n').slice(0,8).join('\n') : undefined
      };
    }
    return res.status(500).json(resp);
  }
};
