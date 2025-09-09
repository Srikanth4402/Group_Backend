import express from 'express';
const router = express.Router();
import { addReview } from '../controllers/ReviewController.js';
import { getReviews } from '../controllers/ReviewController.js';
import { protect } from '../middleware/AuthMiddleware.js';



router.post('/api/users/reviews/add/:productId',protect, addReview);
router.get('/api/product/reviews/:productId', getReviews);

export default router;