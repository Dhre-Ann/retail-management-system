DROP TABLE IF EXISTS Payment CASCADE;
DROP TABLE IF EXISTS ReciptItem CASCADE;
DROP TABLE IF EXISTS Recipt CASCADE;
DROP TABLE IF EXISTS Inventory CASCADE;
DROP TABLE IF EXISTS BankAccount CASCADE;
DROP TABLE IF EXISTS Product CASCADE;
DROP TABLE IF EXISTS Store CASCADE;
DROP TABLE IF EXISTS StateTax CASCADE;

CREATE TABLE StateTax(
state VARCHAR(40) PRIMARY KEY,
tax_rate NUMERIC(5,4) NOT NULL
);

CREATE TABLE Store(
store_id INT PRIMARY KEY,
store_name VARCHAR(100) NOT NULL,
street_address VARCHAR(250) NOT NULL,
city VARCHAR(100) NOT NULL,
state VARCHAR(50) NOT NULL,
zip_code VARCHAR(10) NOT NULL,
aisle_count INT NOT NULL,
FOREIGN KEY (state) REFERENCES StateTax(state)
);

CREATE TABLE Product(
sku VARCHAR(50) PRIMARY KEY,
product_name VARCHAR(100) NOT NULL,
category VARCHAR(50) NOT NULL,
tax_treatment VARCHAR(20) CHECK (tax_treatment IN ('taxtable','tax exempt')),
unit_price NUMERIC(10,2) NOT NULL,
sold_by_weight BOOLEAN NOT NULL,
unit_of_measure VARCHAR(10) NOT NULL
);

CREATE TABLE Inventory(
store_id INT,
sku VARCHAR(50),
availible_quantity INT NOT NULL CHECK (availible_quantity >=0),
aisle_number INT,
PRIMARY KEY(store_id,sku),
FOREIGN KEY(store_id) REFERENCES Store(store_id) ON DELETE CASCADE,
FOREIGN KEY(sku) REFERENCES Product(sku) ON DELETE CASCADE
);

CREATE TABLE BankAccount(
account_id INT PRIMARY KEY,
account_holder_name VARCHAR(100) NOT NULL,
account_number VARCHAR(50) UNIQUE NOT NULL,
account_balance NUMERIC(10,2) NOT NULL
);

CREATE TABLE Recipt(
recipt_id INT PRIMARY KEY,
store_id INT NOT NULL,
recipt_date DATE NOT NULL,
recipt_time TIME NOT NULL,
subtotal NUMERIC(10,2) NOT NULL,
tax_amount NUMERIC(10,2) NOT NULL,
total_amount NUMERIC(10,2) NOT NULL,
FOREIGN KEY(store_id) REFERENCES Store(store_id)
);

CREATE TABLE ReciptItem(
recipt_id INT,
recipt_line_number INT,
sku VARCHAR(50) NOT NULL,
quantity INT,
weight NUMERIC(8,2),
unit_price NUMERIC(10,2) NOT NULL,
line_total NUMERIC(10,2) NOT NULL,
PRIMARY KEY (recipt_id,recipt_line_number),
FOREIGN KEY (recipt_id) REFERENCES Recipt(recipt_id),
FOREIGN KEY (sku) REFERENCES Product(sku)
);

CREATE TABLE Payment(
payment_id INT PRIMARY KEY,
recipt_id INT UNIQUE NOT NULL,
account_id INT,
payment_method VARCHAR(20) CHECK (payment_method in ('cash','card'))NOT NULL,
amount NUMERIC(10,2) NOT NULL,
payment_date DATE NOT NULL,
payment_time TIME NOT NULL,
payment_status VARCHAR(10) CHECK(payment_status IN ('approved','declined'))NOT NULL,
CONSTRAINT chk_card_account CHECK(payment_method='cash' OR (payment_method='card' AND account_id IS NOT NULL)),
FOREIGN KEY (recipt_id) REFERENCES Recipt(recipt_id) ON DELETE CASCADE,
FOREIGN KEY (account_id) REFERENCES BankAccount(account_id)
);