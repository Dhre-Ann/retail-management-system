-- Q1. Sales per store (Store JOIN Receipt)
SELECT s.store_id, s.store_name, s.city, s.state,
       COUNT(r.receipt_id)                AS num_receipts,
       COALESCE(SUM(r.total_amount), 0)   AS total_sales
FROM Store s
LEFT JOIN Receipt r
       ON r.store_id = s.store_id
      AND r.receipt_date BETWEEN :start_date AND :end_date
GROUP BY s.store_id, s.store_name, s.city, s.state
ORDER BY total_sales DESC;

-- Q2. Top 10 products by revenue (ReceiptItem JOIN Product)
SELECT p.sku, p.product_name, p.category,
       SUM(ri.quantity)    AS units_sold,
       SUM(ri.weight)      AS lbs_sold,
       SUM(ri.line_total)  AS revenue
FROM ReceiptItem ri
JOIN Product p ON p.sku = ri.sku
GROUP BY p.sku, p.product_name, p.category
ORDER BY revenue DESC
LIMIT 10;

-- Q3. Tax collected per state (StateTax JOIN Store JOIN Receipt)
SELECT st.state, st.tax_rate,
       COUNT(r.receipt_id)                AS num_receipts,
       COALESCE(SUM(r.subtotal), 0)       AS subtotal,
       COALESCE(SUM(r.tax_amount), 0)     AS tax_collected
FROM StateTax st
JOIN Store s        ON s.state = st.state
LEFT JOIN Receipt r ON r.store_id = s.store_id
GROUP BY st.state, st.tax_rate
ORDER BY tax_collected DESC;

-- Q4. Full receipt lookup (Receipt JOIN Store JOIN ReceiptItem JOIN Product, LEFT JOIN Payment)
SELECT r.receipt_id, s.store_name, r.receipt_date, r.receipt_time,
       ri.receipt_line_number, p.product_name, ri.quantity, ri.weight,
       ri.unit_price, ri.line_total,
       r.subtotal, r.tax_amount, r.total_amount,
       pay.payment_method
FROM Receipt r
JOIN Store s          ON s.store_id = r.store_id
JOIN ReceiptItem ri   ON ri.receipt_id = r.receipt_id
JOIN Product p        ON p.sku = ri.sku
LEFT JOIN Payment pay ON pay.receipt_id = r.receipt_id
WHERE r.receipt_id = :receipt_id
ORDER BY ri.receipt_line_number;
