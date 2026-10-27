-- seed.sql
-- Run AFTER schema.sql.
--   StateTax -> Store -> Product -> Inventory -> BankAccount
-- Receipt, ReceiptItem and Payment arent seeded; simulation makes them.
-- ON CONFLICT DO NOTHING inserts missing rows and leaves existing rows,
-- including sold quantities and spent balances, unchanged.
 
-- 1. StateTax (first: Store.state references it). 
INSERT INTO supermarkets.statetax (state, tax_rate) VALUES
  ('TX', 0.0825),
  ('GA', 0.089),
  ('NY', 0.08875),
  ('CO', 0.0881),
  ('FL', 0.07),
  ('CA', 0.0875),
  ('IL', 0.0875),
  ('WA', 0.1025),
  ('AZ', 0.084),
  ('NC', 0.07)
ON CONFLICT DO NOTHING;
 
-- 2. Store: 100 stores, 10 per state, aisle_count between 20 and 40
INSERT INTO supermarkets.store (store_id, store_name, street_address, city, state, zip_code, aisle_count) VALUES
  (1, 'FreshMart Houston #1', '137 Oak Ave', 'Houston', 'TX', '77008', 25),
  (2, 'FreshMart Atlanta #2', '174 Maple Dr', 'Atlanta', 'GA', '30315', 30),
  (3, 'FreshMart Brooklyn #3', '211 Congress Ave', 'Brooklyn', 'NY', '11222', 35),
  (4, 'FreshMart Denver #4', '248 Peachtree St', 'Denver', 'CO', '80229', 40),
  (5, 'FreshMart Miami #5', '285 Elm St', 'Miami', 'FL', '33136', 24),
  (6, 'FreshMart Los Angeles #6', '322 Market St', 'Los Angeles', 'CA', '90043', 29),
  (7, 'FreshMart Chicago #7', '359 Lake Blvd', 'Chicago', 'IL', '60650', 34),
  (8, 'FreshMart Seattle #8', '396 Park Ave', 'Seattle', 'WA', '98157', 39),
  (9, 'FreshMart Phoenix #9', '433 Highland Rd', 'Phoenix', 'AZ', '85064', 23),
  (10, 'FreshMart Charlotte #10', '470 Main St', 'Charlotte', 'NC', '28271', 28),
  (11, 'FreshMart Austin #11', '507 Maple Dr', 'Austin', 'TX', '78778', 33),
  (12, 'FreshMart Savannah #12', '544 Congress Ave', 'Savannah', 'GA', '31485', 38),
  (13, 'FreshMart Buffalo #13', '581 Peachtree St', 'Buffalo', 'NY', '14292', 22),
  (14, 'FreshMart Boulder #14', '618 Elm St', 'Boulder', 'CO', '80399', 27),
  (15, 'FreshMart Orlando #15', '655 Market St', 'Orlando', 'FL', '32807', 32),
  (16, 'FreshMart San Diego #16', '692 Lake Blvd', 'San Diego', 'CA', '92114', 37),
  (17, 'FreshMart Springfield #17', '729 Park Ave', 'Springfield', 'IL', '62721', 21),
  (18, 'FreshMart Spokane #18', '766 Highland Rd', 'Spokane', 'WA', '99228', 26),
  (19, 'FreshMart Tucson #19', '803 Main St', 'Tucson', 'AZ', '85735', 31),
  (20, 'FreshMart Raleigh #20', '840 Oak Ave', 'Raleigh', 'NC', '27642', 36),
  (21, 'FreshMart Dallas #21', '877 Congress Ave', 'Dallas', 'TX', '75249', 20),
  (22, 'FreshMart Augusta #22', '914 Peachtree St', 'Augusta', 'GA', '30956', 25),
  (23, 'FreshMart Albany #23', '951 Elm St', 'Albany', 'NY', '12263', 30),
  (24, 'FreshMart Aurora #24', '988 Market St', 'Aurora', 'CO', '80070', 35),
  (25, 'FreshMart Tampa #25', '125 Lake Blvd', 'Tampa', 'FL', '33677', 40),
  (26, 'FreshMart Sacramento #26', '162 Park Ave', 'Sacramento', 'CA', '95884', 24),
  (27, 'FreshMart Naperville #27', '199 Highland Rd', 'Naperville', 'IL', '60591', 29),
  (28, 'FreshMart Tacoma #28', '236 Main St', 'Tacoma', 'WA', '98498', 34),
  (29, 'FreshMart Mesa #29', '273 Oak Ave', 'Mesa', 'AZ', '85206', 39),
  (30, 'FreshMart Durham #30', '310 Maple Dr', 'Durham', 'NC', '27713', 23),
  (31, 'FreshMart Houston #31', '347 Peachtree St', 'Houston', 'TX', '77020', 28),
  (32, 'FreshMart Atlanta #32', '384 Elm St', 'Atlanta', 'GA', '30327', 33),
  (33, 'FreshMart Brooklyn #33', '421 Market St', 'Brooklyn', 'NY', '11234', 38),
  (34, 'FreshMart Denver #34', '458 Lake Blvd', 'Denver', 'CO', '80241', 22),
  (35, 'FreshMart Miami #35', '495 Park Ave', 'Miami', 'FL', '33148', 27),
  (36, 'FreshMart Los Angeles #36', '532 Highland Rd', 'Los Angeles', 'CA', '90055', 32),
  (37, 'FreshMart Chicago #37', '569 Main St', 'Chicago', 'IL', '60662', 37),
  (38, 'FreshMart Seattle #38', '606 Oak Ave', 'Seattle', 'WA', '98169', 21),
  (39, 'FreshMart Phoenix #39', '643 Maple Dr', 'Phoenix', 'AZ', '85076', 26),
  (40, 'FreshMart Charlotte #40', '680 Congress Ave', 'Charlotte', 'NC', '28283', 31),
  (41, 'FreshMart Austin #41', '717 Elm St', 'Austin', 'TX', '78790', 36),
  (42, 'FreshMart Savannah #42', '754 Market St', 'Savannah', 'GA', '31497', 20),
  (43, 'FreshMart Buffalo #43', '791 Lake Blvd', 'Buffalo', 'NY', '14205', 25),
  (44, 'FreshMart Boulder #44', '828 Park Ave', 'Boulder', 'CO', '80312', 30),
  (45, 'FreshMart Orlando #45', '865 Highland Rd', 'Orlando', 'FL', '32819', 35),
  (46, 'FreshMart San Diego #46', '902 Main St', 'San Diego', 'CA', '92126', 40),
  (47, 'FreshMart Springfield #47', '939 Oak Ave', 'Springfield', 'IL', '62733', 24),
  (48, 'FreshMart Spokane #48', '976 Maple Dr', 'Spokane', 'WA', '99240', 29),
  (49, 'FreshMart Tucson #49', '113 Congress Ave', 'Tucson', 'AZ', '85747', 34),
  (50, 'FreshMart Raleigh #50', '150 Peachtree St', 'Raleigh', 'NC', '27654', 39),
  (51, 'FreshMart Dallas #51', '187 Market St', 'Dallas', 'TX', '75261', 23),
  (52, 'FreshMart Augusta #52', '224 Lake Blvd', 'Augusta', 'GA', '30968', 28),
  (53, 'FreshMart Albany #53', '261 Park Ave', 'Albany', 'NY', '12275', 33),
  (54, 'FreshMart Aurora #54', '298 Highland Rd', 'Aurora', 'CO', '80082', 38),
  (55, 'FreshMart Tampa #55', '335 Main St', 'Tampa', 'FL', '33689', 22),
  (56, 'FreshMart Sacramento #56', '372 Oak Ave', 'Sacramento', 'CA', '95896', 27),
  (57, 'FreshMart Naperville #57', '409 Maple Dr', 'Naperville', 'IL', '60504', 32),
  (58, 'FreshMart Tacoma #58', '446 Congress Ave', 'Tacoma', 'WA', '98411', 37),
  (59, 'FreshMart Mesa #59', '483 Peachtree St', 'Mesa', 'AZ', '85218', 21),
  (60, 'FreshMart Durham #60', '520 Elm St', 'Durham', 'NC', '27725', 26),
  (61, 'FreshMart Houston #61', '557 Lake Blvd', 'Houston', 'TX', '77032', 31),
  (62, 'FreshMart Atlanta #62', '594 Park Ave', 'Atlanta', 'GA', '30339', 36),
  (63, 'FreshMart Brooklyn #63', '631 Highland Rd', 'Brooklyn', 'NY', '11246', 20),
  (64, 'FreshMart Denver #64', '668 Main St', 'Denver', 'CO', '80253', 25),
  (65, 'FreshMart Miami #65', '705 Oak Ave', 'Miami', 'FL', '33160', 30),
  (66, 'FreshMart Los Angeles #66', '742 Maple Dr', 'Los Angeles', 'CA', '90067', 35),
  (67, 'FreshMart Chicago #67', '779 Congress Ave', 'Chicago', 'IL', '60674', 40),
  (68, 'FreshMart Seattle #68', '816 Peachtree St', 'Seattle', 'WA', '98181', 24),
  (69, 'FreshMart Phoenix #69', '853 Elm St', 'Phoenix', 'AZ', '85088', 29),
  (70, 'FreshMart Charlotte #70', '890 Market St', 'Charlotte', 'NC', '28295', 34),
  (71, 'FreshMart Austin #71', '927 Park Ave', 'Austin', 'TX', '78703', 39),
  (72, 'FreshMart Savannah #72', '964 Highland Rd', 'Savannah', 'GA', '31410', 23),
  (73, 'FreshMart Buffalo #73', '101 Main St', 'Buffalo', 'NY', '14217', 28),
  (74, 'FreshMart Boulder #74', '138 Oak Ave', 'Boulder', 'CO', '80324', 33),
  (75, 'FreshMart Orlando #75', '175 Maple Dr', 'Orlando', 'FL', '32831', 38),
  (76, 'FreshMart San Diego #76', '212 Congress Ave', 'San Diego', 'CA', '92138', 22),
  (77, 'FreshMart Springfield #77', '249 Peachtree St', 'Springfield', 'IL', '62745', 27),
  (78, 'FreshMart Spokane #78', '286 Elm St', 'Spokane', 'WA', '99252', 32),
  (79, 'FreshMart Tucson #79', '323 Market St', 'Tucson', 'AZ', '85759', 37),
  (80, 'FreshMart Raleigh #80', '360 Lake Blvd', 'Raleigh', 'NC', '27666', 21),
  (81, 'FreshMart Dallas #81', '397 Highland Rd', 'Dallas', 'TX', '75273', 26),
  (82, 'FreshMart Augusta #82', '434 Main St', 'Augusta', 'GA', '30980', 31),
  (83, 'FreshMart Albany #83', '471 Oak Ave', 'Albany', 'NY', '12287', 36),
  (84, 'FreshMart Aurora #84', '508 Maple Dr', 'Aurora', 'CO', '80094', 20),
  (85, 'FreshMart Tampa #85', '545 Congress Ave', 'Tampa', 'FL', '33602', 25),
  (86, 'FreshMart Sacramento #86', '582 Peachtree St', 'Sacramento', 'CA', '95809', 30),
  (87, 'FreshMart Naperville #87', '619 Elm St', 'Naperville', 'IL', '60516', 35),
  (88, 'FreshMart Tacoma #88', '656 Market St', 'Tacoma', 'WA', '98423', 40),
  (89, 'FreshMart Mesa #89', '693 Lake Blvd', 'Mesa', 'AZ', '85230', 24),
  (90, 'FreshMart Durham #90', '730 Park Ave', 'Durham', 'NC', '27737', 29),
  (91, 'FreshMart Houston #91', '767 Main St', 'Houston', 'TX', '77044', 34),
  (92, 'FreshMart Atlanta #92', '804 Oak Ave', 'Atlanta', 'GA', '30351', 39),
  (93, 'FreshMart Brooklyn #93', '841 Maple Dr', 'Brooklyn', 'NY', '11258', 23),
  (94, 'FreshMart Denver #94', '878 Congress Ave', 'Denver', 'CO', '80265', 28),
  (95, 'FreshMart Miami #95', '915 Peachtree St', 'Miami', 'FL', '33172', 33),
  (96, 'FreshMart Los Angeles #96', '952 Elm St', 'Los Angeles', 'CA', '90079', 38),
  (97, 'FreshMart Chicago #97', '989 Market St', 'Chicago', 'IL', '60686', 22),
  (98, 'FreshMart Seattle #98', '126 Lake Blvd', 'Seattle', 'WA', '98193', 27),
  (99, 'FreshMart Phoenix #99', '163 Park Ave', 'Phoenix', 'AZ', '85001', 32),
  (100, 'FreshMart Charlotte #100', '200 Highland Rd', 'Charlotte', 'NC', '28208', 37)
ON CONFLICT DO NOTHING;
 
-- 3. Product (unit_price is the base price; for weighted items it is price per lb)
INSERT INTO supermarkets.product (sku, product_name, category, tax_treatment, unit_price, sold_by_weight, unit_of_measure) VALUES
  ('BAN-001', 'Bananas', 'Produce', 'exempt', 0.69, TRUE, 'lb'),
  ('APL-014', 'Gala Apples', 'Produce', 'exempt', 1.59, TRUE, 'lb'),
  ('ROM-003', 'Romaine Lettuce', 'Produce', 'exempt', 1.89, TRUE, 'lb'),
  ('TOM-008', 'Vine Tomatoes', 'Produce', 'exempt', 2.29, TRUE, 'lb'),
  ('MLK-101', 'Whole Milk, 1 gal', 'Dairy', 'exempt', 3.49, FALSE, 'each'),
  ('EGG-102', 'Large Eggs, dozen', 'Dairy', 'exempt', 4.19, FALSE, 'each'),
  ('BRD-210', 'Whole Wheat Bread', 'Bakery', 'exempt', 2.99, FALSE, 'each'),
  ('CHK-301', 'Chicken Breast', 'Meat', 'exempt', 6.49, FALSE, 'each'),
  ('BEE-302', 'Ground Beef 80/20, 1 lb', 'Meat', 'exempt', 5.99, FALSE, 'each'),
  ('BAC-303', 'Smoked Bacon, 12 oz', 'Meat', 'exempt', 6.79, FALSE, 'each'),
  ('COL-401', 'Cola, 12 pack', 'Beverages', 'taxable', 7.49, FALSE, 'each'),
  ('CHP-402', 'Kettle Potato Chips', 'Snacks', 'taxable', 3.99, FALSE, 'each'),
  ('DEL-403', 'Rotisserie Chicken', 'Deli', 'taxable', 8.99, FALSE, 'each'),
  ('HHD-501', 'Dish Soap, 18 oz', 'Household', 'taxable', 2.79, FALSE, 'each'),
  ('HHD-502', 'Paper Towels, 6 rolls', 'Household', 'taxable', 8.49, FALSE, 'each')
ON CONFLICT DO NOTHING;
 
-- 4. Inventory: every store stocks every product 
INSERT INTO supermarkets.inventory (store_id, sku, available_quantity, aisle_number)
SELECT s.store_id,
       p.sku,
       CASE WHEN (s.store_id + p.rn) % 13 = 0 THEN 1 + (s.store_id + p.rn) % 8
            WHEN p.sold_by_weight            THEN 40 + s.store_id % 10
            ELSE                                  36 + s.store_id % 10 END,
       CASE p.category WHEN 'Produce' THEN 2  WHEN 'Dairy' THEN 4    WHEN 'Bakery' THEN 6
                       WHEN 'Meat'    THEN 8  WHEN 'Beverages' THEN 10 WHEN 'Snacks' THEN 12
                       WHEN 'Deli'    THEN 14 ELSE 16 END
FROM supermarkets.store s
CROSS JOIN (SELECT sku, category, sold_by_weight, ROW_NUMBER() OVER (ORDER BY sku) AS rn FROM supermarkets.product) p
ON CONFLICT DO NOTHING;
 
-- 5. BankAccount (simulated): 20 accounts, some with small balances
INSERT INTO banking.bankaccount (account_id, account_holder_name, account_number, account_balance) VALUES
  (1, 'Maria Chen', '1000004521', 250.00),
  (2, 'James Okonkwo', '1000008834', 12.50),
  (3, 'Priya Shah', '1000002290', 1500.00),
  (4, 'Luis Garcia', '1000006712', 64.20),
  (5, 'Ava Nguyen', '1000001188', 430.00),
  (6, 'Noah Patel', '1000028555', 980.00),
  (7, 'Emma Johnson', '1000032266', 35.75),
  (8, 'Liam Brown', '1000035977', 2200.00),
  (9, 'Olivia Davis', '1000039688', 150.00),
  (10, 'Ethan Martinez', '1000043399', 72.40),
  (11, 'Sophia Wilson', '1000047110', 640.00),
  (12, 'Mason Lee', '1000050821', 18.00),
  (13, 'Isabella Clark', '1000054532', 3100.00),
  (14, 'Lucas Hall', '1000058243', 505.50),
  (15, 'Mia Young', '1000061954', 90.00),
  (16, 'Henry King', '1000065665', 1250.00),
  (17, 'Amelia Scott', '1000069376', 45.00),
  (18, 'Jack Green', '1000073087', 820.00),
  (19, 'Harper Baker', '1000076798', 300.00),
  (20, 'Owen Adams', '1000080509', 5.00)
ON CONFLICT DO NOTHING;
 
-- 
 