// server.js (ESM)
import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import bcrypt from 'bcrypt';

// import routes (make sure these paths exist)
import ProductRoute from './routes/ProductRoute.js';
import OrderRoute from './routes/OrderRoute.js';
import UserRoute from './routes/UserRoute.js';
import CartRoute from './routes/CartRoute.js';
import AddressRoute from './routes/AddressRoute.js';
import ChatBotRoute from './routes/ChatBotRoute.js';
import wishListRoute from './routes/WishListRoutes.js';
import ReviewRoute from './routes/ReviewRoute.js';
import AdminRoute from './routes/AdminRoute.js';
import PasswordResetRoute from './routes/PasswordResetRoute.js';

import User from './models/UserModel.js';

dotenv.config();

const app = express();

// Basic env-checking / defaults
const mongoUri = process.env.MONGO_URI_CONNECTION_STRING;
if (!mongoUri) {
  console.error("Missing MONGO_URI_CONNECTION_STRING in .env — please set it and restart.");
}

const PORT = process.env.PORT || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn("Warning: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is not set. Payment endpoints will fail until set.");
}

// Middlewares
app.use(helmet());

app.use(
  cors()
);

// Parse JSON bodies
app.use(express.json({ limit: "1mb" }));

// HTTP request logger
app.use(morgan("dev"));

// connect to mongodb
(async function connectDB() {
  try {
    if (!mongoUri) {
      console.error("No MongoDB URI provided; skipping connection attempt.");
      return;
    }
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to MongoDB database");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error && error.message ? error.message : error);
    // don't exit here in case the developer wants to debug locally;
    // you may choose to process.exit(1) in production
  }
})();

// app routes (mounted at root — your routers should define specific paths)
app.use('/', ProductRoute);
app.use('/', OrderRoute);
app.use('/', UserRoute);
app.use('/', CartRoute);
app.use('/', ChatBotRoute);
app.use('/', AddressRoute);
app.use('/', wishListRoute);
app.use('/', ReviewRoute);
app.use('/', AdminRoute);
app.use('/', PasswordResetRoute);

// Admin creation endpoint (dev-only usage expected)
app.post('/api/users/admin/create', async (req, res) => {
  try {
    const secretKey = req.body.secretKey;
    if (secretKey !== process.env.ADMIN_SECRET_KEY) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      return res.status(400).json({ message: "Admin already exists" });
    }
    const password = req.body.password;
    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);
    const newAdmin = await User.create({
      username: req.body.username,
      email: req.body.email,
      password: hashedPassword,
      role: 'admin'
    });
    return res.status(200).json({ message: "Admin created successfully", admin: newAdmin });
  } catch (error) {
    console.error("Error creating admin:", error);
    res.status(500).json({ message: "Error creating admin" });
  }
});

//
// Razorpay integration
//
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || '',
  key_secret: process.env.RAZORPAY_KEY_SECRET || ''
});

// health check for payments
app.get('/api/payment', (_, res) => res.send('Razorpay Backend OK'));

// Create an order
app.post('/api/create-order', async (req, res) => {
  try {
    // Accept either amountInRupees or amountInPaise (prefer paise when present)
    let { amountInRupees, amountInPaise, receiptNotes } = req.body;

    if (amountInPaise == null) {
      const numeric = Number(amountInRupees ?? 2);
      if (isNaN(numeric) || numeric <= 0) {
        return res.status(400).json({ error: 'Invalid amountInRupees' });
      }
      amountInPaise = Math.round(numeric * 100); // convert to paise
    } else {
      amountInPaise = Number(amountInPaise);
      if (isNaN(amountInPaise) || amountInPaise <= 0) {
        return res.status(400).json({ error: 'Invalid amountInPaise' });
      }
    }

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: 'rcpt_' + Date.now(),
      notes: Object.assign({ purpose: 'React demo' }, receiptNotes || {})
    });

    // Respond with the fields the frontend expects
    res.json({ id: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    console.error('Create order error:', err && (err.message || err));
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Verify payment signature
app.post('/api/verify-payment', (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ ok: false, error: 'Missing required fields: razorpay_order_id, razorpay_payment_id, razorpay_signature' });
    }
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(body).digest('hex');
    const ok = expected === razorpay_signature;
    if (ok) return res.json({ ok: true });
    return res.status(400).json({ ok: false, error: 'Invalid signature' });
  } catch (err) {
    console.error('Verify payment error:', err && (err.message || err));
    res.status(500).json({ ok: false, error: 'Verification error' });
  }
});

// Generic root health-check
app.get('/', (req, res) => res.send('API server is running'));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
