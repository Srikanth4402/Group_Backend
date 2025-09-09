import Order from "../models/OrderModel.js";
import Product from "../models/ProductModel.js";
import User from "../models/UserModel.js";
import WishList from "../models/WishListModel.js";
import Review from "../models/ReviewModel.js";
import Cart from "../models/CartModel.js";
import mongoose from "mongoose";

export const getAllUsersActivity = async (req, res) => {
    try {
        const users = await User.find().select("_id name email createdAt recentSearches");

        const userActivityData = await Promise.all(
            users.map(async (user) => {
                const purchasedProducts = await Order.find({ userId: user._id })
                    .populate("items.productId", "img") // Only populate img if not stored on order item
                    .then((orders) =>
                        orders.flatMap((order) =>
                            order.items
                                .filter((item) => item.productId) // Ensure productId is not null
                                .map((item) => ({
                                    _id: item.productId._id, // Product ID from ref
                                    title: item.title,       // Directly from order item
                                    img: item.productId ? item.productId.img : '', // From populated product or default
                                    price: item.price,       // Directly from order item
                                }))
                        )
                    );

                const cartProducts = await Cart.findOne({ userId: user._id })
                    // No need to populate for title, img, price as they are stored directly
                    .then((cart) =>
                        cart?.items
                            .filter((item) => item.productId) // Ensure productId is not null
                            .map((item) => ({
                                _id: item.productId._id, // Product ID from ref
                                title: item.title,       // Directly from cart item
                                img: item.img,           // Directly from cart item
                                price: item.price,       // Directly from cart item
                            })) || []
                    );

                const wishlistProducts = await WishList.findOne({ userId: user._id })
                    .populate("products", "title img newPrice") // Correct populate path and select newPrice
                    .then((wishlist) =>
                        wishlist?.products
                            .filter((product) => product) // Filter out any null/undefined populated products
                            .map((product) => ({ // 'product' here is the populated Product document
                                _id: product._id,
                                title: product.title,
                                img: product.img,
                                price: product.newPrice, // Access newPrice directly from the populated product
                            })) || []
                    );

                const reviews = await Review.find({ "reviews.userId": user._id })
                    .populate({
                        path: 'productId',
                        select: 'title'
                    })
                    .then((productReviews) => {
                        return productReviews.flatMap((reviewDoc) => {
                            return reviewDoc.reviews
                                .filter(subReview => subReview.userId && subReview.userId.equals(user._id))
                                .map(subReview => ({
                                    _id: subReview._id ? subReview._id.toString() : new mongoose.Types.ObjectId().toString(),
                                    productTitle: reviewDoc.productId ? reviewDoc.productId.title : 'Unknown Product',
                                    rating: subReview.rating,
                                    text: subReview.review,
                                    createdAt: reviewDoc.createdAt ? reviewDoc.createdAt.toISOString() : ''
                                }));
                        });
                    });

                return {
                    userId: user._id,
                    name: user.name,
                    email: user.email,
                    createdAt: user.createdAt,
                    recentSearches: user.recentSearches || [],
                    purchasedProducts,
                    cartProducts,
                    wishlistProducts,
                    reviews,
                };
            })
        );

        res.status(200).json(userActivityData);
    } catch (error) {
        console.error("Error fetching user activity data:", error);
        res.status(500).json({ message: "Error fetching user activity data" });
    }
};


// Fetch monthly sales data
export const getSalesData = async (req, res) => {
    try {
        const salesData = await Order.aggregate([
            {
                $group: {
                    _id: { $month: "$orderDate" }, // Group by month
                    totalSales: { $sum: "$totalAmount" }, // Sum totalAmount for each month
                },
            },
            { $sort: { _id: 1 } }, // Sort by month
        ]);

        const labels = salesData.map((data) => `Month ${data._id}`);
        const data = salesData.map((data) => data.totalSales);

        res.status(200).json({ labels, data });
    } catch (error) {
        console.error("Error fetching sales data:", error);
        res.status(500).json({ message: "Error fetching sales data" });
    }
};

// Fetch order distribution data
export const getOrderDistribution = async (req, res) => {
    try {
        const orderDistribution = await Order.aggregate([
            {
                $group: {
                    _id: "$status", // Group by order status
                    count: { $sum: 1 }, // Count the number of orders for each status
                },
            },
        ]);

        const labels = orderDistribution.map((data) => data._id);
        const data = orderDistribution.map((data) => data.count);

        res.status(200).json({ labels, data });
    } catch (error) {
        console.error("Error fetching order distribution data:", error);
        res.status(500).json({ message: "Error fetching order distribution data" });
    }
};

// Fetch category sales data
export const getCategorySalesData = async (req, res) => {
    try {
        const categorySales = await Product.aggregate([
            {
                $group: {
                    _id: "$category", // Group by product category
                    totalSales: { $sum: "$newPrice" }, // Sum newPrice for each category
                },
            },
        ]);

        const labels = categorySales.map((data) => data._id);
        const data = categorySales.map((data) => data.totalSales);

        res.status(200).json({ labels, data });
    } catch (error) {
        console.error("Error fetching category sales data:", error);
        res.status(500).json({ message: "Error fetching category sales data" });
    }
};










// Fetch admin stats
export const getAdminStats = async ( req, res ) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalOrders = await Order.countDocuments();
        const totalProducts = await Product.countDocuments();
        const totalRevenue = await Order.aggregate([
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: "$totalAmount"}
                }
            }
        ]);
        const stats = {
            totalOrders,
            totalProducts,
            totalUsers,
            totalRevenue: totalRevenue.length > 0 ? totalRevenue[0].totalRevenue : 0 // Handle case where no orders exist
        }
        // console.log(totalUsers, totalOrders, totalProducts, totalRevenue);
        return res.status(200).json({message: "Admin stats fetched successfully",stats: stats});
        
    } catch (error) {
        console.error("Error fetching admin stats:", error);
        res.status(500).json({ message: "Error fetching admin stats" });
        
    }
}