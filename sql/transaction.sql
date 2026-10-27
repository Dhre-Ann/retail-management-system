-- =============================================================================
-- Checkout transaction trace for reference
--
-- Source: server/services/checkoutService.js, processCheckout()
--
-- This file records the SQL that processCheckout() sends to PostgreSQL, in
-- the order the approved-sale path runs. It is not a standalone script
-- Placeholders ($1, $2, ...) are bound by the application. Loops, money
-- math, validation, and the cash/card branch are application logic; they
-- are described in comments and are not SQL.
--
-- Do not execute this file!!!!!
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Before BEGIN (application only; no SQL)
--
-- processCheckout() rejects the payload and never opens a transaction when:
--   store_id is not an integer
--   payment_method is not 'cash' or 'card'
--   items is missing, not an array, or empty
--   card payment and account_id is not an integer
--   cash payment and account_id is not null
-- That failure throws Error('Invalid checkout request'), statusCode 400.
--
-- pool.connect() runs next. If it fails, the function throws
-- Error('Database connection failed'), statusCode 500, still with no SQL.
-- -----------------------------------------------------------------------------

BEGIN;

-- -----------------------------------------------------------------------------
-- Store and state tax
-- $1 = store_id
-- -----------------------------------------------------------------------------
SELECT s.store_id, t.tax_rate
FROM supermarkets.store s
JOIN supermarkets.statetax t ON s.state = t.state
WHERE s.store_id = $1;

-- Application: zero rows throws Error('Store not found'). The catch block
-- then issues ROLLBACK (see "Error exit" below) and rethrows.
--
-- Otherwise:
--   taxRate = Number(tax_rate)
--   subtotalCents = 0
--   taxableCents = 0
-- Items are copied and sorted by SKU (localeCompare) before the inventory
-- loop so concurrent checkouts lock inventory rows in the same order.
-- A Set records SKUs already seen in this request.


-- -----------------------------------------------------------------------------
-- Product lookup and inventory row lock
-- Repeated once per sorted item. The application stops the loop on the
-- first invalid line; remaining SKUs are not queried.
-- $1 = item.sku
-- $2 = store_id
-- FOR UPDATE OF i locks the inventory row until COMMIT or ROLLBACK.
-- -----------------------------------------------------------------------------
SELECT p.sku, p.unit_price, p.tax_treatment,
       p.sold_by_weight, i.available_quantity
FROM supermarkets.product p
JOIN supermarkets.inventory i ON i.sku = p.sku
WHERE p.sku = $1 AND i.store_id = $2
FOR UPDATE OF i;

-- Application, before this SELECT for the current item:
--   missing item, non-string sku, or a sku already seen throws
--   Error('Invalid or duplicate SKU'). No query is sent for that item.
--
-- Application, after this SELECT:
--   zero rows throws Error('Product <sku> is not stocked here').
--   sold_by_weight chooses the amount: item.weight when true, item.quantity
--   when false.
--   Weighed line is invalid when quantity is present, weight is not finite,
--   weight is <= 0, or weight has more than two decimal places
--   (abs(amount * 100 - round(amount * 100)) > 1e-8).
--   Counted line is invalid when weight is present, quantity is not a safe
--   integer, or quantity is <= 0.
--   Those cases throw Error('Invalid quantity or weight for <sku>').
--   available_quantity < amount throws Error('Insufficient stock for <sku>').
--   Each of those throws reaches the catch block, which issues ROLLBACK.
--
--   Line amount in cents:
--     lineCents = round(Number(unit_price) * amount * 100)
--     subtotalCents += lineCents
--     if tax_treatment = 'taxable' then taxableCents += lineCents
--   The line kept for later inserts:
--     quantity = amount for counted items, null for weighed items
--     weight   = amount for weighed items, null for counted items
--     unit_price from the product row
--     line_total = (lineCents / 100) fixed to two decimals
--     amount as above (used only for the inventory update)
--
-- After every item:
--   taxCents   = round(taxableCents * taxRate)
--   totalCents = subtotalCents + taxCents
--   total      = (totalCents / 100) fixed to two decimals
-- Cash does not touch banking.bankaccount. Card continues below.


-- -----------------------------------------------------------------------------
-- Card balance deduction
-- Issued only when payment_method = 'cash' is false (payment_method = 'card').
-- $1 = total (two-decimal text)
-- $2 = account_id
-- The balance predicate makes the debit conditional: a row is returned only
-- when the account exists and account_balance >= total.
-- -----------------------------------------------------------------------------
UPDATE banking.bankaccount
SET account_balance = account_balance - $1
WHERE account_id = $2
  AND account_balance >= $1
RETURNING account_id;

-- Application: if this UPDATE returns a row, the approved path continues
-- at the receipt lock below.
--
-- If it returns no row, the service does not insert a receipt, receipt
-- items, inventory changes, or a payment, and it does not COMMIT. It runs
-- the SELECT and ROLLBACK in "Card decline exit", then either throws
-- Error('Bank account not found') or returns
-- { saved: false, message: 'Insufficient funds' }.


-- -----------------------------------------------------------------------------
-- Receipt id lock and receipt insert
-- pg_advisory_xact_lock(3380, 1) is the existing transaction-scoped lock
-- held for receipt_id generation. It releases on COMMIT or ROLLBACK.
--
-- Receipt parameters:
--   $1 = store_id
--   $2 = (subtotalCents / 100) fixed to two decimals
--   $3 = (taxCents / 100) fixed to two decimals
--   $4 = total
-- receipt_id is COALESCE(MAX(receipt_id), 0) + 1 inside this transaction.
-- -----------------------------------------------------------------------------
SELECT pg_advisory_xact_lock(3380, 1);

INSERT INTO supermarkets.receipt
    (receipt_id, store_id, receipt_date, receipt_time,
     subtotal, tax_amount, total_amount)
VALUES (
    (SELECT COALESCE(MAX(receipt_id), 0) + 1
     FROM supermarkets.receipt),
    $1, CURRENT_DATE, LOCALTIME,
    $2, $3, $4
)
RETURNING receipt_id;

-- Application: receiptId = returned receipt_id.
-- Lines are written in sorted-SKU order, not the original request order.
-- receipt_line_number is the 1-based index in that order.


-- -----------------------------------------------------------------------------
-- Receipt line and inventory update
-- Repeated once per purchased line, in that same order. For each line the
-- INSERT runs first, then the UPDATE.
--
-- Receipt item:
--   $1 = receiptId
--   $2 = line number (i + 1)
--   $3 = sku
--   $4 = quantity (null when sold by weight)
--   $5 = weight (null when sold by count)
--   $6 = unit_price from the locked product row
--   $7 = line_total (two-decimal text)
--
-- Inventory:
--   $1 = amount (quantity or weight)
--   $2 = store_id
--   $3 = sku
-- The inventory row was locked earlier by FOR UPDATE OF i.
-- -----------------------------------------------------------------------------
INSERT INTO supermarkets.receiptitem
    (receipt_id, receipt_line_number, sku,
     quantity, weight, unit_price, line_total)
VALUES ($1, $2, $3, $4, $5, $6, $7);

UPDATE supermarkets.inventory
SET available_quantity = available_quantity - $1
WHERE store_id = $2 AND sku = $3;


-- -----------------------------------------------------------------------------
-- Payment id lock and approved payment
-- pg_advisory_xact_lock(3380, 2) is the existing transaction-scoped lock
-- held for payment_id generation. It releases on COMMIT or ROLLBACK.
--
-- $1 = receiptId
-- $2 = account_id when payment_method = 'card', otherwise null
-- $3 = payment_method ('cash' or 'card')
-- $4 = total
-- payment_status is the literal 'approved'.
-- payment_id is COALESCE(MAX(payment_id), 0) + 1 inside this transaction.
-- -----------------------------------------------------------------------------
SELECT pg_advisory_xact_lock(3380, 2);

INSERT INTO supermarkets.payment
    (payment_id, receipt_id, account_id, payment_method,
     amount, payment_date, payment_time, payment_status)
VALUES (
    (SELECT COALESCE(MAX(payment_id), 0) + 1
     FROM supermarkets.payment),
    $1, $2, $3, $4, CURRENT_DATE, LOCALTIME, 'approved'
);

-- Application then commits and returns
-- { saved: true, receipt_id, subtotal, tax, total, payment_status: 'approved' }
-- with subtotal, tax, and total as cent totals divided by 100.

COMMIT;


-- =============================================================================
-- Card decline exit
-- Not part of the approved path above. processCheckout() issues these two
-- statements only when the bankaccount UPDATE returns no row. ROLLBACK ends
-- the transaction here.
-- $1 = account_id
-- =============================================================================
SELECT account_id
FROM banking.bankaccount
WHERE account_id = $1;

ROLLBACK;

-- Application after that ROLLBACK:
--   zero rows: throw Error('Bank account not found'), statusCode 400,
--   with rolledBack set so the catch block does not ROLLBACK again.
--   a row exists: return { saved: false, message: 'Insufficient funds' }
--   without throwing.
-- The client is released in finally either way.


-- =============================================================================
-- Error exit
-- Not part of the approved path. For any other error thrown inside the
-- try block, the catch block issues ROLLBACK when error.rolledBack is not
-- set, logs the message, and rethrows. A ROLLBACK failure is ignored.
-- The client is released in finally.
-- =============================================================================
ROLLBACK;
