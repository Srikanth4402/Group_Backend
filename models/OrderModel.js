import mongoose from 'mongoose';

const OrderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [
    {
      productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
      },
      title: { type: String, required: true },
      quantity: { type: Number, required: true, min: 1 },
      price: { type: Number, required: true }
    }
  ],
  totalAmount: { type: Number, required: true },
  status: {
    type: String,
    enum: [
      'Pending',
      'Processing',
      'Shipped',
      'Delivered',
      'Cancelled',
      'Refunded',
      'Return Requested',
      'Returned & Refunded'
    ],
    default: 'Pending'
  },
  orderDate: { type: Date, default: Date.now, required: true },
  shippingAddress: { type: String, required: true },

  // OTP fields
  deliveryOtp: { type: String, required: false },
  otpExpiresAt: { type: Date, required: false },
  otpVerified: { type: Boolean, default: false }

}, { timestamps: true });

const Order = mongoose.model("Order", OrderSchema);
export default Order;
