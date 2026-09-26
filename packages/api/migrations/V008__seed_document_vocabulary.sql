INSERT INTO document_types (id, owner_id, name, description, active)
VALUES
    ('10000000-0000-4000-8000-000000000001', NULL, 'Invoice', 'Invoices and bills', TRUE),
    ('10000000-0000-4000-8000-000000000002', NULL, 'Contract', 'Contracts and agreements', TRUE),
    ('10000000-0000-4000-8000-000000000003', NULL, 'Official letter', 'Letters and notices from authorities', TRUE),
    ('10000000-0000-4000-8000-000000000004', NULL, 'Insurance document', 'Insurance policies and correspondence', TRUE),
    ('10000000-0000-4000-8000-000000000005', NULL, 'Receipt', 'Receipts and proof of purchase', TRUE),
    ('10000000-0000-4000-8000-000000000006', NULL, 'Vehicle document', 'Vehicle-related documents, inspections, and maintenance', TRUE),
    ('10000000-0000-4000-8000-000000000007', NULL, 'Medical document', 'Medical reports and correspondence', TRUE),
    ('10000000-0000-4000-8000-000000000008', NULL, 'Tax document', 'Tax returns, assessments, and tax correspondence', TRUE),
    ('10000000-0000-4000-8000-000000000009', NULL, 'Bank document', 'Bank statements and banking correspondence', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO document_categories (id, owner_id, parent_id, name, description, active)
VALUES
    ('20000000-0000-4000-8000-000000000001', NULL, NULL, 'Finance', 'Money, banking, and financial administration', TRUE),
    ('20000000-0000-4000-8000-000000000002', NULL, NULL, 'Contracts', 'Agreements and legal commitments', TRUE),
    ('20000000-0000-4000-8000-000000000003', NULL, NULL, 'Vehicle', 'Cars, inspections, maintenance, and mobility', TRUE),
    ('20000000-0000-4000-8000-000000000004', NULL, NULL, 'Insurance', 'Insurance policies and claims', TRUE),
    ('20000000-0000-4000-8000-000000000005', NULL, NULL, 'Health', 'Medical and health-related documents', TRUE),
    ('20000000-0000-4000-8000-000000000006', NULL, NULL, 'Authorities', 'Government and administrative correspondence', TRUE),
    ('20000000-0000-4000-8000-000000000007', NULL, NULL, 'Home', 'Rent, utilities, repairs, and property', TRUE),
    ('20000000-0000-4000-8000-000000000008', NULL, '20000000-0000-4000-8000-000000000001', 'Taxes', 'Tax-related documents', TRUE)
ON CONFLICT (id) DO NOTHING;
