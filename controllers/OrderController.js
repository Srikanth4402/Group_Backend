// controllers/OrderController.js
import mongoose from "mongoose";
import Order from "../models/OrderModel.js";
import User from "../models/UserModel.js";
import Product from "../models/ProductModel.js";
import { sendMail } from "../utils/MailSender.js";

const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

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

    return res.status(200).json({
      message: "Order created successfully",
      order: newOrder,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ message: "Internal error", error: error.message });
  }
};

/* -----------------------------------------
 * Get orders for logged-in user (formatted for frontend)
 * Returns: [{ id, date, totalAmount, status, items: [{productId, title, quantity, price, image}] }]
 * ----------------------------------------- */
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
      order.otpExpiresAt = Date.now() + 1 * 24 * 60 * 60 * 1000; // 1 day
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

      await sendMail({
  to: order.userId.email,
  subject: "Your Delivery OTP",
  text: `Your delivery OTP is ${otp}. Valid for 10 minutes. Order: ${order._id}`,
  html: `<p>Your OTP: <b>${otp}</b></p>`,
});

      return res.status(200).json({
        message: "Order updated to Shipped. OTP sent to user.",
        order,
      });
    }

    order.status = status;
    await order.save();
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
    // console.log("Verifying OTP with data:", req.params, req.body);
    const { orderId } = req.params;
    const { userOtp } = req.body;

    const order = await Order.findById(orderId);
    // console.log("Found order:", order);

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

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const idx = order.items.findIndex((i) => i.productId.toString() === productId);
    if (idx === -1) return res.status(404).json({ message: "Product not in order" });

    const item = order.items[idx];
    order.totalAmount -= item.price * item.quantity;
    order.items.splice(idx, 1);
    if (order.items.length === 0) order.status = "Cancelled";

    await order.save();
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


export const requestReturn=async (req,res)=>{
  try {
    const { id } = req.params;
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    order.status = "Return Requested";
    await order.save();

    res.status(200).json({ message: "Return requested", order });
  } catch (error) {
    console.error("Request return error:", error);
    res.status(500).json({ message: "Failed to request return" });
  }
};  