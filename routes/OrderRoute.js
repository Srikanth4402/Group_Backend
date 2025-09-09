// routes/OrderRoutes.js
import express from 'express';
import { protect, admin } from '../middleware/AuthMiddleware.js';
import {
  createOrder,
  getOrdersForUser,
  getAllOrders,
  updateOrderStatus,
  cancelOrderItem,
  getOrderStatus,
  verifyDeliveryOtp,
  requestReturn,          // <-- make sure this is imported
} from '../controllers/OrderController.js';

const router = express.Router();

router.post('/api/orders/add', createOrder);
router.get('/api/orders/getOrders', protect, getOrdersForUser);
router.get('/api/orders/getAllOrders', protect, admin, getAllOrders);
router.put('/api/orders/updateStatus/:orderId', protect, admin, updateOrderStatus);
router.post('/api/orders/cancel-item/:id', protect, cancelOrderItem);
router.get('/api/orders/status/:id', protect, getOrderStatus);
router.post('/api/orders/verify-otp/:orderId', protect, verifyDeliveryOtp);
router.post('/api/orders/request-return/:id', protect, requestReturn);

export default router;
