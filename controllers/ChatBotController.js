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
- If outside scope, say: "I'm sorry, I can only assist with inquiries related to MyAwesomeShop's products, orders, and services. For other questions, please contact our human support team at support@myawesomeshop.com or call us at +1-800-123-4567."
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

// Build short order context (PII redacted) — used for OpenAI prompts when needed
function buildOrderContext(order) {
  if (!order) return '';
  const itemDetails = (order.items || []).map(item => `${item.title} ($${item.price})`).join(', ') || 'No items listed';
  const shipping = redactAddress(order.shippingAddress);
  return `Order #${order._id || order.orderNumber || 'unknown'}:
- Items: ${itemDetails}
- Status: ${order.status || 'unknown'}
- Total Amount: $${order.totalAmount ?? 'unknown'}
- Ordered At: ${order.orderDate ? new Date(order.orderDate).toLocaleString('en-US') : 'unknown'}
- Delivery Location: ${shipping}`;
}

const isDev = process.env.NODE_ENV !== 'production';

// Simple retry wrapper for OpenAI calls (keeps previous behavior)
async function openaiWithRetry(payload, retries = 1) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
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
    const eta = order.estimatedDeliveryDate ? ` Estimated delivery: ${new Date(order.estimatedDeliveryDate).toLocaleDateString('en-US')}.` : '';
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
  reply += `\n\nOrder summary: ${(order.items || []).map(i => i.title).slice(0,3).join(', ') || 'No items listed'} — Total: $${order.totalAmount ?? 'unknown'} — Delivery location: ${shipping}`;

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
  const textLines = cart.map(c => `• ${c.title} — ${c.qty} × ${c.price != null ? `$${c.price}` : 'N/A'}${c.lineTotal != null ? ` = $${c.lineTotal.toFixed(2)}` : ''}`);
  const text = `You have ${cart.length} item(s) in your cart:\n\n${textLines.join('\n')}\n\nSubtotal: $${subtotal.toFixed(2)}. Reply "checkout" to proceed or "remove <index>" to remove an item.`;

  return { text, cart, subtotal };
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
    // Detect order-like tokens
    const orderIdMatch = rawMessage.match(/(?:track order|order id|order|order#|order #|tracking|tracking number)\s*[:#]?\s*([A-Za-z0-9\-\_]{4,})/i);
    const orderIdCandidate = orderIdMatch ? orderIdMatch[1] : null;

    // Quick-handled intents (no OpenAI)
    if (inputMessage.includes("return policy") || inputMessage.includes("returns")) {
      intent = "returns";
      botReply = "Our return policy allows returns within 30 days of purchase for a full refund. Some exclusions may apply to sale or digital items. For specifics, see the product page or contact support@myawesomeshop.com.";
      return res.status(200).json({ reply: botReply, intent, contextProvided: false });
    }

    if (inputMessage.includes("shipping cost") || inputMessage.includes("shipping costs") || inputMessage.includes("shipping")) {
      intent = "shipping";
      botReply = "Standard shipping is free on orders over $50. Exact costs are shown at checkout based on your address and selected shipping speed.";
      return res.status(200).json({ reply: botReply, intent, contextProvided: false });
    }

    if (inputMessage.includes("payment methods") || inputMessage.includes("payment")) {
      intent = "payments";
      botReply = "We accept Visa, MasterCard, Amex, Discover, PayPal, and Google Pay.";
      return res.status(200).json({ reply: botReply, intent, contextProvided: false });
    }

    if (["hello", "hi", "hey"].includes(inputMessage) || inputMessage.startsWith("hello") || inputMessage.startsWith("hi")) {
      intent = "greeting";
      botReply = "Hello! 👋 How can I help you with your MyAwesomeShop products, orders, or account today?";
      return res.status(200).json({ reply: botReply, intent, contextProvided: false });
    }

    // CART flow (reads from Cart collection by userId first)
    if (inputMessage.includes("my cart") || inputMessage === "cart" || inputMessage.includes("show cart")) {
      intent = "cart";

      if (!incomingUserId) {
        botReply = "To view your cart please log in to your account on our website.";
        return res.status(200).json({ reply: botReply, intent, contextProvided: false });
      }

      // Try to find cart document in Cart collection by userId
      let cartDoc = null;
      try {
        // allow both string or ObjectId
        const query = mongoose.Types.ObjectId.isValid(incomingUserId) ? { userId: incomingUserId } : { userId: incomingUserId };
        cartDoc = await Cart.findOne(query).lean();
      } catch (dbErr) {
        console.error("[ChatBot] DB error fetching cart document:", dbErr);
      }

      // If no Cart doc, try fallback to user.cart
      let cartItemsRaw = [];
      if (cartDoc) {
        console.log("[ChatBot] Found cart document for user:", incomingUserId);
        // cartDoc may have multiple shapes: { items: [...] } or { cart: [...] } or direct array
        if (Array.isArray(cartDoc.items) && cartDoc.items.length) {
          cartItemsRaw = cartDoc.items;
        } else if (Array.isArray(cartDoc.cart) && cartDoc.cart.length) {
          cartItemsRaw = cartDoc.cart;
        } else if (Array.isArray(cartDoc.products) && cartDoc.products.length) {
          cartItemsRaw = cartDoc.products;
        } else {
          // try any top-level array-like fields
          const arrField = Object.keys(cartDoc).find(k => Array.isArray(cartDoc[k]));
          if (arrField) cartItemsRaw = cartDoc[arrField];
        }
      } else {
        // fallback: read user document (older systems might keep cart on user)
        let user = null;
        try {
          user = await User.findById(incomingUserId).lean();
        } catch (dbErr) {
          console.error("[ChatBot] DB error fetching user for cart fallback:", dbErr);
        }
        if (user) {
          console.log("[ChatBot] No cart doc; falling back to user document cart fields for user:", incomingUserId);
          if (Array.isArray(user.cart) && user.cart.length) cartItemsRaw = user.cart;
          else if (user.cart && Array.isArray(user.cart.items) && user.cart.items.length) cartItemsRaw = user.cart.items;
          else if (Array.isArray(user.currentCart) && user.currentCart.length) cartItemsRaw = user.currentCart;
          else if (user.basket && Array.isArray(user.basket.items)) cartItemsRaw = user.basket.items;
        }
      }

      // At this point cartItemsRaw may be: [] or array of strings or array of objects
      // Normalize strings -> { productId, qty:1 }
      cartItemsRaw = (cartItemsRaw || []).map(ci => {
        if (typeof ci === 'string') return { productId: ci, qty: 1 };
        return ci;
      });

      // Best-effort normalization & populate product data (preserve items even if product lookup fails)
      const normalizedCart = await Promise.all(cartItemsRaw.map(async (ci) => {
        try {
          // If item already has product info, use it
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
            // no product id — return as-is
            return { productId: null, title: ci.title || 'Unknown product', price: ci.price ?? null, qty: ci.qty ?? ci.quantity ?? 1 };
          }

          const pidStr = typeof pid === 'object' && (pid._id || pid.id) ? String(pid._id || pid.id) : String(pid);

          let prod = null;
          try {
            if (pidStr.match(/^[0-9a-fA-F]{24}$/)) {
              prod = await Product.findById(pidStr).lean();
            } else {
              // try lookup by sku/slug/productNumber
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

          // fallback: product not found in DB — keep provided info
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

      // Build the reply and return both raw and normalized carts for frontend visibility
      const { text, cart, subtotal } = localCartReply(normalizedCart);

      // Prepare rawCart for debugging (original cart doc/array)
      const rawCartDebug = cartDoc ? (cartDoc.items || cartDoc.cart || cartDoc.products || cartDoc) : (Array.isArray(cartItemsRaw) ? cartItemsRaw : []);

      return res.status(200).json({
        reply: text,
        intent,
        contextProvided: true,
        rawCart: rawCartDebug,
        cart,
        subtotal: typeof subtotal === 'number' ? subtotal : undefined
      });
    }

    // TRACK ORDER flow
    if (inputMessage.includes("track order") || inputMessage.includes("track my order") || inputMessage === "track" || inputMessage.startsWith("track ")) {
      intent = "track_order";

      // If user provided exact ID-like token, try to find it
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
          return res.status(200).json({ reply: botReply, intent, contextProvided: false });
        }

        // Build and return a local deterministic reply (no OpenAI required)
        const localReply = localOrderStatusReply(order);
        contextProvided = true;
        return res.status(200).json({ reply: localReply, intent, contextProvided });
      }

      // If user didn't supply ID, require login to list recent orders
      if (!incomingUserId) {
        botReply = "Please provide your order ID (e.g., 'Order #12345ABC') or log in so I can show your recent orders to select from.";
        return res.status(200).json({ reply: botReply, intent, contextProvided: false });
      }

      // Numeric selection (user may reply "1", "2", etc.) - try to detect
      const numericSelection = rawMessage.trim().match(/^(\d{1,2})$/);

      let userOrders = [];
      try {
        userOrders = await Order.find({ userId: incomingUserId }).sort({ orderDate: -1 }).limit(10).lean();
      } catch (dbErr) {
        console.error("[ChatBot] DB error fetching user orders for selection:", dbErr);
      }

      if (!userOrders || userOrders.length === 0) {
        botReply = "I couldn't find any recent orders under your account. If you think this is a mistake, please check your account page or contact support@myawesomeshop.com.";
        return res.status(200).json({ reply: botReply, intent, contextProvided: false });
      }

      // If numeric selection, map to the nth recent order (1-based)
      if (numericSelection) {
        const idx = parseInt(numericSelection[1], 10) - 1;
        if (idx >= 0 && idx < userOrders.length) {
          const order = userOrders[idx];
          // Deterministic local reply
          const localReply = localOrderStatusReply(order);
          contextProvided = true;
          return res.status(200).json({ reply: localReply, intent, contextProvided });
        } else {
          botReply = `I don't have an order at position ${numericSelection[1]}. I found ${userOrders.length} recent orders. Please reply with the correct index (1-${userOrders.length}) or an order id.`;
          return res.status(200).json({ reply: botReply, intent, contextProvided: false });
        }
      }

      // Otherwise show recent orders so the user can choose (frontend will render clickable choices)
      const ordersSummary = userOrders.map(o => {
        const items = (o.items || []).map(i => i.title).slice(0,3).join(', ') || 'No items';
        const shortDate = o.orderDate ? new Date(o.orderDate).toLocaleDateString('en-US') : 'Unknown date';
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
      const textualList = ordersSummary.map((s, idx) => `${idx + 1}. ${s.itemsSummary} — ${s.status} — $${s.totalAmount} — ${s.orderedAt} (id: ${s.id})`).join('\n');

      return res.status(200).json({
        reply: `${botReply}\n\n${textualList}`,
        intent: "select_order",
        contextProvided: false,
        orders: ordersSummary
      });
    }

    // RECENT ORDERS flow
    if (inputMessage.includes("my order") || inputMessage.includes("purchase history") || inputMessage.includes("recent orders") || inputMessage.includes("recent purchases")) {
      intent = "recent_orders";
      if (!incomingUserId) {
        botReply = "To view your orders, please log in to your account on our website.";
        return res.status(200).json({ reply: botReply, intent, contextProvided: false });
      }

      let userOrders = [];
      try {
        userOrders = await Order.find({ userId: incomingUserId }).sort({ orderDate: -1 }).limit(5).lean();
      } catch (dbErr) {
        console.error("[ChatBot] DB error fetching user orders:", dbErr);
      }

      if (!userOrders || userOrders.length === 0) {
        botReply = "You don't seem to have any recent orders. If you think this is an error, please contact support@myawesomeshop.com.";
        return res.status(200).json({ reply: botReply, intent, contextProvided: false });
      }

      const summary = userOrders.map(o => {
        const items = (o.items || []).map(i => i.title).join(', ') || 'No items';
        return `• ${items} — ${o.status || 'status unknown'} — $${o.totalAmount ?? '0'} — ${new Date(o.orderDate).toLocaleDateString('en-US')} — id: ${String(o._id)}`;
      }).join('\n');

      const prompt = `${SYSTEM_INSTRUCTION}

Relevant context (user recent orders, PII redacted):
${summary}

User's message: ${rawMessage}

Please respond concisely, e.g., list the recent orders and next steps (tracking, contact support) or ask clarifying questions.`;

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
        return res.status(200).json({ reply: botReply, intent, contextProvided, orders: userOrders.map(o => ({
          id: String(o._id),
          items: (o.items || []).map(i => i.title).slice(0,3).join(', '),
          status: o.status || 'unknown',
          totalAmount: o.totalAmount ?? 0,
          orderedAt: o.orderDate ? new Date(o.orderDate).toLocaleDateString('en-US') : 'unknown'
        })) });
      } catch (openAiErr) {
        console.error("[ChatBot] OpenAI error (recent orders):", openAiErr);
        // Fallback to a simple local summary if OpenAI fails
        const fallbackSummary = userOrders.map(o => {
          const items = (o.items || []).map(i => i.title).join(', ') || 'No items';
          return `• ${items} — ${o.status || 'status unknown'} — $${o.totalAmount ?? '0'} — ${o.orderDate ? new Date(o.orderDate).toLocaleDateString('en-US') : 'unknown'} — id: ${String(o._id)}`;
        }).join('\n');
        return res.status(200).json({
          reply: `Here are your recent orders:\n\n${fallbackSummary}`,
          intent,
          contextProvided: true,
          orders: userOrders.map(o => ({
            id: String(o._id),
            itemsSummary: (o.items || []).map(i => i.title).slice(0,3).join(', '),
            status: o.status || 'unknown',
            totalAmount: o.totalAmount ?? 0,
            orderedAt: o.orderDate ? new Date(o.orderDate).toLocaleDateString('en-US') : 'unknown'
          }))
        });
      }
    }

    // Generic (OpenAI) fall-back; keeps system instruction scope enforcement
    intent = "openai_answer";
    const prompt = `
${SYSTEM_INSTRUCTION}

User's message: ${rawMessage}

Please answer the user's question as best as you can but remain within the shop domain. If the question is outside MyAwesomeShop's scope, reply with the short scope-referral message.
`;

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
      return res.status(200).json({ reply: botReply, intent, contextProvided: false });
    } catch (openAiErr) {
      console.error("[ChatBot] OpenAI error (fallback):", openAiErr);
      const fallback = "Sorry — I couldn't generate a smart reply right now. Please try again or contact support@myawesomeshop.com.";
      if (isDev) {
        return res.status(200).json({ reply: fallback, intent, contextProvided: false, _debugOpenAIError: String(openAiErr) });
      }
      return res.status(200).json({ reply: fallback, intent, contextProvided: false });
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
