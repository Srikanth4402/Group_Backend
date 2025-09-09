import express from "express";
import { getSalesData, getOrderDistribution, getCategorySalesData, getAdminStats, getAllUsersActivity } from "../controllers/AdminController.js";
import { protect, admin } from "../middleware/AuthMiddleware.js";

const router = express.Router();

// Route to fetch sales analytics
router.get('/api/admin/sales', protect, admin, getSalesData);

// Route to fetch order distribution data
router.get('/api/admin/orders', protect, admin, getOrderDistribution);

// Route to fetch category sales data
router.get('/api/admin/category-sales', protect, admin, getCategorySalesData);


// Route to fetch admin stats
router.get('/api/admin/stats', protect, admin, getAdminStats);




// Route to fetch all users' activity
router.get("/api/users/activity", protect, admin, getAllUsersActivity);

export default router;