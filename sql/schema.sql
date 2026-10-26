
-- Creating Schemas: supermarkets and banking


CREATE SCHEMA IF NOT EXISTS supermarkets;
CREATE SCHEMA IF NOT EXISTS banking;

CREATE TABLE IF NOT EXISTS supermarkets.statetax (
    state VARCHAR(40) PRIMARY KEY,
    tax_rate NUMERIC(5,4) NOT NULL
);

CREATE TABLE IF NOT EXISTS supermarkets.store (
    store_id INT PRIMARY KEY,
    store_name VARCHAR(100) NOT NULL,
    street_address VARCHAR(250) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(50) NOT NULL,
    zip_code VARCHAR(10) NOT NULL,
    aisle_count INT NOT NULL,
    FOREIGN KEY (state)
        REFERENCES supermarkets.statetax(state)
);

CREATE TABLE IF NOT EXISTS supermarkets.product (
    sku VARCHAR(50) PRIMARY KEY,
    product_name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    tax_treatment VARCHAR(20)
        CHECK (tax_treatment IN ('taxable', 'tax exempt')),
    unit_price NUMERIC(10,2) NOT NULL,
    sold_by_weight BOOLEAN NOT NULL,
    unit_of_measure VARCHAR(10) NOT NULL
);

CREATE TABLE IF NOT EXISTS supermarkets.inventory (
    store_id INT,
    sku VARCHAR(50),
    available_quantity INT NOT NULL
        CHECK (available_quantity >= 0),
    aisle_number INT,
    PRIMARY KEY (store_id, sku),
    FOREIGN KEY (store_id)
        REFERENCES supermarkets.store(store_id)
        ON DELETE CASCADE,
    FOREIGN KEY (sku)
        REFERENCES supermarkets.product(sku)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS banking.bankaccount (
    account_id INT PRIMARY KEY,
    account_holder_name VARCHAR(100) NOT NULL,
    account_number VARCHAR(50) UNIQUE NOT NULL,
    account_balance NUMERIC(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS supermarkets.receipt (
    receipt_id INT PRIMARY KEY,
    store_id INT NOT NULL,
    receipt_date DATE NOT NULL,
    receipt_time TIME NOT NULL,
    subtotal NUMERIC(10,2) NOT NULL,
    tax_amount NUMERIC(10,2) NOT NULL,
    total_amount NUMERIC(10,2) NOT NULL,
    FOREIGN KEY (store_id)
        REFERENCES supermarkets.store(store_id)
);

CREATE TABLE IF NOT EXISTS supermarkets.receiptitem (
    receipt_id INT,
    receipt_line_number INT,
    sku VARCHAR(50) NOT NULL,
    quantity INT,
    weight NUMERIC(8,2),
    unit_price NUMERIC(10,2) NOT NULL,
    line_total NUMERIC(10,2) NOT NULL,
    PRIMARY KEY (receipt_id, receipt_line_number),
    FOREIGN KEY (receipt_id)
        REFERENCES supermarkets.receipt(receipt_id),
    FOREIGN KEY (sku)
        REFERENCES supermarkets.product(sku)
);

CREATE TABLE IF NOT EXISTS supermarkets.payment (
    payment_id INT PRIMARY KEY,
    receipt_id INT UNIQUE NOT NULL,
    account_id INT,
    payment_method VARCHAR(20)
        CHECK (payment_method IN ('cash', 'card')) NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    payment_date DATE NOT NULL,
    payment_time TIME NOT NULL,
    payment_status VARCHAR(10)
        CHECK (payment_status IN ('approved', 'declined')) NOT NULL,
    CONSTRAINT chk_card_account CHECK (
        payment_method = 'cash'
        OR (payment_method = 'card' AND account_id IS NOT NULL)
    ),
    FOREIGN KEY (receipt_id)
        REFERENCES supermarkets.receipt(receipt_id)
        ON DELETE CASCADE,
    FOREIGN KEY (account_id)
        REFERENCES banking.bankaccount(account_id)
);
