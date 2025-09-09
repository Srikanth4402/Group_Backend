import express from 'express';
import { addProductToWishlist, getWishlist, removeProductFromWishlist } from '../controllers/WishListController.js';
import { protect } from '../middleware/AuthMiddleware.js';
const router = express.Router();
router.post('/api/users/wishlist/add/:productId', protect, addProductToWishlist);
router.get('/api/users/wishlist/getItems', protect, getWishlist);
router.delete('/api/users/wishlist/remove/:productId', protect, removeProductFromWishlist);

export default router;