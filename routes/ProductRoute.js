import express from "express";
import { createProduct, getProducts, getProduct, deleteProduct, updateProduct, searchProducts, getImageUrl, getAllProducts ,bulkCreateProducts} from "../controllers/ProductController.js";
import { protect, admin } from "../middleware/AuthMiddleware.js";

const router = express.Router();

router.post('/api/products/add', protect, admin, createProduct);


router.post('/api/products/bulk-create',  bulkCreateProducts);

router.get('/api/products',getProducts);
router.get('/api/products/getAllProducts', getAllProducts);
router.get('/api/products/search', searchProducts);
router.get('/api/product/:id', getProduct);
router.delete('/api/product/delete/:id',protect, admin, deleteProduct);
router.put('/api/product/update/:id',protect, admin, updateProduct);
router.get('/api/products/getProductImage/:orderProductId', getImageUrl);

export default router;
