-- Q1. Sales per store (Store JOIN Receipt)
-- $1 and $2 are local calendar dates. $3 is the IANA time zone of those dates.
-- Receipt date and time are stored in the database time zone. The end date includes that whole local day.
SELECT
    s.store_id,
    s.store_name,
    s.city,
    s.state,
    COUNT(r.receipt_id) AS num_receipts,
    COALESCE(SUM(r.total_amount), 0) AS total_sales
FROM supermarkets.store s
LEFT JOIN supermarkets.receipt r
    ON r.store_id = s.store_id
    AND ((r.receipt_date + r.receipt_time) AT TIME ZONE current_setting('TIMEZONE'))
        >= ($1::timestamp AT TIME ZONE $3)
    AND ((r.receipt_date + r.receipt_time) AT TIME ZONE current_setting('TIMEZONE'))
        < (($2::date + INTERVAL '1 day') AT TIME ZONE $3)
GROUP BY s.store_id, s.store_name, s.city, s.state
ORDER BY total_sales DESC;

-- Q2. Top 10 Products by Revenue
SELECT
    p.sku,
    p.product_name,
    p.category,
    COALESCE(SUM(ri.quantity), 0) AS units_sold,
    COALESCE(SUM(ri.weight), 0) AS lbs_sold,
    COALESCE(SUM(ri.line_total), 0) AS revenue
FROM supermarkets.receiptitem ri
JOIN supermarkets.product p
    ON p.sku = ri.sku
GROUP BY p.sku, p.product_name, p.category
ORDER BY revenue DESC
LIMIT 10;

-- Q3. Tax collected per state (StateTax JOIN Store JOIN Receipt)
SELECT
    st.state,
    st.tax_rate,
    COUNT(r.receipt_id) AS num_receipts,
    COALESCE(SUM(r.subtotal), 0) AS subtotal,
    COALESCE(SUM(r.tax_amount), 0) AS tax_collected
FROM supermarkets.statetax st
JOIN supermarkets.store s
    ON s.state = st.state
LEFT JOIN supermarkets.receipt r
    ON r.store_id = s.store_id
GROUP BY st.state, st.tax_rate
ORDER BY tax_collected DESC;


-- Q4. Sales Total per state
SELECT
    s.state,
    COUNT(r.receipt_id) AS num_receipts,
    COALESCE(SUM(r.total_amount), 0) AS total_sales
FROM supermarkets.store s
LEFT JOIN supermarkets.receipt r
    ON r.store_id = s.store_id
GROUP BY s.state
ORDER BY total_sales DESC;

-- Q5. Low-Stock Items per State
-- Low stock threshold: fewer than 10 units/lbs per store
SELECT
    s.state,
    s.store_id,
    s.store_name,
    p.sku,
    p.product_name,
    i.available_quantity,
    p.unit_of_measure
FROM supermarkets.inventory i
JOIN supermarkets.store s
    ON s.store_id = i.store_id
JOIN supermarkets.product p
    ON p.sku = i.sku
WHERE i.available_quantity < 10
ORDER BY s.state, i.available_quantity ASC;

-- Q6. Payments by Method (Payment JOIN Receipt)
SELECT
    p.payment_method,
    p.payment_status,
    COUNT(*) AS num_payments,
    COALESCE(SUM(p.amount), 0) AS total_amount
FROM supermarkets.payment p
JOIN supermarkets.receipt r
    ON r.receipt_id = p.receipt_id
GROUP BY p.payment_method, p.payment_status
ORDER BY p.payment_method, p.payment_status;



-- Q7. Full receipt lookup (Receipt JOIN Store JOIN ReceiptItem JOIN Product, LEFT JOIN Payment)
-- Parameter: $1 = receipt_id
SELECT
    r.receipt_id,
    s.store_name,
    r.receipt_date,
    r.receipt_time,
    ri.receipt_line_number,
    p.product_name,
    ri.quantity,
    ri.weight,
    ri.unit_price,
    ri.line_total,
    r.subtotal,
    r.tax_amount,
    r.total_amount,
    pay.payment_method
FROM supermarkets.receipt r
JOIN supermarkets.store s
    ON s.store_id = r.store_id
JOIN supermarkets.receiptitem ri
    ON ri.receipt_id = r.receipt_id
JOIN supermarkets.product p
    ON p.sku = ri.sku
LEFT JOIN supermarkets.payment pay
    ON pay.receipt_id = r.receipt_id
WHERE r.receipt_id = $1
ORDER BY ri.receipt_line_number;
