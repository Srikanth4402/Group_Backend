import express from 'express';
import { addToCart } from '../controllers/CartController.js';
import { removeFromCart, getCartItems, deleteAfterOrdering } from '../controllers/CartController.js';
import { protect, admin } from '../middleware/AuthMiddleware.js';
const router = express.Router();

router.post('/api/users/cart/add',protect, addToCart);
router.delete('/api/users/cart/remove/:userId/:productId',protect, removeFromCart);
router.get('/api/user/cart/getItems',protect, getCartItems);
router.delete('/api/users/cart/remove/:userId',protect, deleteAfterOrdering);

export default router;