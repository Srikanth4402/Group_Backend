// controllers/OrderController.js
import mongoose from "mongoose";
import Order from "../models/OrderModel.js";
import User from "../models/UserModel.js";
import Product from "../models/ProductModel.js";
import { sendMail } from "../utils/MailSender.js";

const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const buildItemsSummaryText = (items = []) =>
  items
    .map(
      (it) =>
        `${it.title || (it.productId && it.productId.name) || "Item"} — Qty: ${it.quantity} — Price: ${it.price}`
    )
    .join("\n");

const buildItemsSummaryHtml = (items = []) =>
  `<ul>${items
    .map(
      (it) =>
        `<li>${it.title || (it.productId && it.productId.name) || "Item"} — Qty: ${it.quantity} — Price: ${it.price}</li>`
    )
    .join("")}</ul>`;

/* -----------------------------------------
 * Create Order
 * ----------------------------------------- */
export const createOrder = async (req, res) => {
  try {
    const { userId, items, totalAmount, status, shippingAddress } = req.body;

    if (!userId || !Array.isArray(items) || items.length === 0 || !shippingAddress) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const newOrder = await Order.create({
      userId: new mongoose.Types.ObjectId(userId),
      items: items.map((item) => ({
        productId: new mongoose.Types.ObjectId(item.productId),
        title: item.title,
        quantity: item.quantity,
        price: item.price,
      })),
      totalAmount,
      status: status || "Pending",
      orderDate: new Date(),
      shippingAddress,
    });

    // send confirmation email to user (non-blocking but awaited so we can log errors)
    try {
      const text = `Hi ${user.username || "Customer"},\n\nYour order has been placed successfully.\n\nOrder ID: ${newOrder._id}\nStatus: ${newOrder.status}\nTotal: ${newOrder.totalAmount}\n\nItems:\n${buildItemsSummaryText(newOrder.items)}\n\nShipping Address:\n${JSON.stringify(newOrder.shippingAddress, null, 2)}\n\nThank you for shopping with us.`;
      const html = `
        <div style="font-family:Arial,sans-serif;color:#222;">
          <h2>Order Confirmation</h2>
          <p>Hi ${user.username || "Customer"},</p>
          <p>Your order has been placed successfully.</p>
          <p><strong>Order ID:</strong> ${newOrder._id}</p>
          <p><strong>Status:</strong> ${newOrder.status}</p>
          <p><strong>Total:</strong> ${newOrder.totalAmount}</p>
          <p><strong>Items:</strong></p>
          ${buildItemsSummaryHtml(newOrder.items)}
          <p><strong>Shipping Address:</strong></p>
          <pre>${JSON.stringify(newOrder.shippingAddress, null, 2)}</pre>
          <hr/>
          <p style="color:#666">E-Commerce Team</p>
        </div>
      `;
      await sendMail({
        to: user.email,
        subject: "Order Confirmation — Thank you for your purchase",
        text,
        html,
      });
    } catch (mailErr) {
      console.error("Failed to send order confirmation email:", mailErr);
    }

    return res.status(200).json({
      message: "Order created successfully",
      order: newOrder,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ message: "Internal error", error: error.message });
  }
};

export const getOrdersForUser = async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user._id }).populate(
      "items.productId",
      "name images"
    );

    const formatted = orders.map((o) => ({
      id: o._id.toString(),
      date: o.orderDate, // your UI expects "date"
      totalAmount: o.totalAmount,
      status: o.status,
      items: (o.items || []).map((it) => ({
        productId: it.productId?._id?.toString() || it.productId?.toString() || null,
        title: it.productId?.name || it.title, // fallback to stored title
        quantity: it.quantity,
        price: it.price,
        image:
          it.productId?.images && it.productId.images.length > 0
            ? it.productId.images[0]
            : null,
      })),
    }));

    res.status(200).json({ message: "Orders fetched successfully", orders: formatted });
  } catch (error) {
    console.error("Error in getOrdersForUser:", error);
    res.status(500).json({ message: "Failed to fetch orders" });
  }
};

/* -----------------------------------------
 * Admin: Get all orders (basic pagination/sorting)
 * ----------------------------------------- */
export const getAllOrders = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.max(parseInt(req.query.limit || "10", 10), 1);
    const sortBy = ["orderDate", "totalAmount", "status", "_id"].includes(req.query.sortBy)
      ? req.query.sortBy
      : "orderDate";
    const sortOrder = (req.query.sortOrder || "desc").toLowerCase() === "asc" ? 1 : -1;

    const totalOrders = await Order.countDocuments();
    const orders = await Order.find()
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("userId", "username email");

    res.status(200).json({ orders, totalOrders });
  } catch (error) {
    console.error("Error fetching all orders:", error);
    res.status(500).json({ message: "Error fetching orders" });
  }
};

export const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    const order = await Order.findById(orderId).populate("userId", "email username");
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (status === "Delivered") {
      return res.status(400).json({
        message:
          "Direct delivery is not allowed. Use /api/orders/verify-delivery-otp/:orderId to verify OTP and mark as Delivered.",
      });
    }

    if (status === "Shipped") {
      // (Re)generate OTP whenever shipping is set
      const otp = generateOtp();
      order.deliveryOtp = otp;
      order.otpExpiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes (match email text)
      order.status = "Shipped";
      await order.save();

      const html = `
        <div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
          <h2>Your order is on the way 🚚</h2>
          <p>Hi ${order.userId.username || "there"},</p>
          <p>Your delivery OTP is:</p>
          <div style="font-size:24px;font-weight:700;letter-spacing:3px;margin:10px 0">${otp}</div>
          <p>This OTP is valid for <strong>10 minutes</strong>. Share it with the delivery agent to complete delivery.</p>
          <p>Order ID: <strong>${order._id}</strong></p>
          <hr />
          <p style="color:#666">E-Commerce Team</p>
        </div>
      `;

      try {
        await sendMail({
          to: order.userId.email,
          subject: "Your Delivery OTP",
          text: `Your delivery OTP is ${otp}. Valid for 10 minutes. Order: ${order._id}`,
          html,
        });
      } catch (mailErr) {
        console.error("Failed to send delivery OTP email:", mailErr);
      }

      return res.status(200).json({
        message: "Order updated to Shipped. OTP sent to user.",
        order,
      });
    }

    // For other statuses (Processing, Cancelled, Return Requested, etc.) update and notify
    order.status = status;
    await order.save();

    // Notify user about status change
    try {
      const text = `Hi ${order.userId.username || "Customer"},\n\nYour order status has been updated.\n\nOrder ID: ${order._id}\nNew Status: ${order.status}\n\nThank you.`;
      const html = `
        <div style="font-family:Arial,sans-serif;color:#222">
          <p>Hi ${order.userId.username || "Customer"},</p>
          <p>Your order <strong>${order._id}</strong> status has been updated to <strong>${order.status}</strong>.</p>
          <p>Thanks for shopping with us.</p>
          <hr/>
          <p style="color:#666">E-Commerce Team</p>
        </div>
      `;
      await sendMail({
        to: order.userId.email,
        subject: `Order Update — ${order.status}`,
        text,
        html,
      });
    } catch (mailErr) {
      console.error("Failed to send order status update email:", mailErr);
    }

    res.status(200).json({ message: "Status updated", order });
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ message: "Failed to update order" });
  }
};

/* -----------------------------------------
 * Verify OTP → mark Delivered
 * ----------------------------------------- */
export const verifyDeliveryOtp = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { userOtp } = req.body;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.status !== "Shipped") {
      return res.status(400).json({ message: "OTP can only be verified for Shipped orders." });
    }
    if (!order.deliveryOtp || !order.otpExpiresAt) {
      return res.status(400).json({ message: "No OTP generated" });
    }
    if (Date.now() > order.otpExpiresAt) {
      return res.status(400).json({ message: "OTP expired" });
    }
    if (order.deliveryOtp !== userOtp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    order.status = "Delivered";
    order.otpVerified = true;
    order.deliveryOtp = null;
    order.otpExpiresAt = null;
    await order.save();

    // Notify user about successful delivery
    try {
      // get user email/username (populate if necessary)
      const user = await User.findById(order.userId).select("email username");
      const text = `Hi ${user?.username || "Customer"},\n\nYour order ${order._id} has been delivered successfully.\n\nThank you for shopping with us.`;
      const html = `
        <div style="font-family:Arial,sans-serif;color:#222">
          <p>Hi ${user?.username || "Customer"},</p>
          <p>Your order <strong>${order._id}</strong> has been delivered successfully.</p>
          <p>We hope you enjoy your purchase.</p>
          <hr/>
          <p style="color:#666">E-Commerce Team</p>
        </div>
      `;
      await sendMail({
        to: user?.email,
        subject: "Order Delivered — Thank you",
        text,
        html,
      });
    } catch (mailErr) {
      console.error("Failed to send delivery confirmation email:", mailErr);
    }

    res.status(200).json({ message: "OTP verified. Order delivered.", order });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({ message: "Failed to verify OTP" });
  }
};

/* -----------------------------------------
 * Cancel item in order
 * ----------------------------------------- */
export const cancelOrderItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { productId } = req.body;

    const order = await Order.findById(id).populate("userId", "email username");
    if (!order) return res.status(404).json({ message: "Order not found" });

    const idx = order.items.findIndex((i) => i.productId.toString() === productId);
    if (idx === -1) return res.status(404).json({ message: "Product not in order" });

    const item = order.items[idx];
    order.totalAmount -= item.price * item.quantity;
    order.items.splice(idx, 1);
    if (order.items.length === 0) order.status = "Cancelled";

    await order.save();

    // Notify user about item cancellation
    try {
      const text = `Hi ${order.userId.username || "Customer"},\n\nAn item was removed from your order ${order._id}.\n\nRemoved Item: ${item.title || item.productId}\nQuantity: ${item.quantity}\n\nNew total: ${order.totalAmount}\n\nIf you didn't request this, contact support.`;
      const html = `
        <div style="font-family:Arial,sans-serif;color:#222">
          <p>Hi ${order.userId.username || "Customer"},</p>
          <p>The following item was removed from your order <strong>${order._id}</strong>:</p>
          <ul>
            <li>${item.title || item.productId} — Qty: ${item.quantity} — Price: ${item.price}</li>
          </ul>
          <p><strong>New total:</strong> ${order.totalAmount}</p>
          <hr/>
          <p style="color:#666">E-Commerce Team</p>
        </div>
      `;
      await sendMail({
        to: order.userId.email,
        subject: "Order Update — Item Removed",
        text,
        html,
      });
    } catch (mailErr) {
      console.error("Failed to send item cancellation email:", mailErr);
    }

    res.status(200).json({ message: "Item removed", order });
  } catch (error) {
    console.error("Cancel error:", error);
    res.status(500).json({ message: "Failed to cancel item" });
  }
};

/* -----------------------------------------
 * Get single order status
 * ----------------------------------------- */
export const getOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id).select("status");
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.status(200).json({ status: order.status });
  } catch (error) {
    console.error("Get status error:", error);
    res.status(500).json({ message: "Failed to get status" });
  }
};

export const requestReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id).populate("userId", "email username");
    if (!order) return res.status(404).json({ message: "Order not found" });

    order.status = "Return Requested";
    await order.save();

    // Notify user about return request accepted
    try {
      const text = `Hi ${order.userId.username || "Customer"},\n\nWe've received your return request for order ${order._id}. Our team will review and contact you with the next steps.\n\nThank you.`;
      const html = `
        <div style="font-family:Arial,sans-serif;color:#222">
          <p>Hi ${order.userId.username || "Customer"},</p>
          <p>We've received your return request for order <strong>${order._id}</strong>. Our team will review and contact you with the next steps.</p>
          <hr/>
          <p style="color:#666">E-Commerce Team</p>
        </div>
      `;
      await sendMail({
        to: order.userId.email,
        subject: "Return Request Received",
        text,
        html,
      });
    } catch (mailErr) {
      console.error("Failed to send return request email:", mailErr);
    }

    res.status(200).json({ message: "Return requested", order });
  } catch (error) {
    console.error("Request return error:", error);
    res.status(500).json({ message: "Failed to request return" });
  }
};
