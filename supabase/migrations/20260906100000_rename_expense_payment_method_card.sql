-- "Debit/Credit Card" was shortened to "Card" in EXPENSE_PAYMENT_METHODS;
-- update existing rows so the list_expenses payment-method filter and the
-- portal's raw-text display stay consistent with the new label.
update expenses set payment_method = 'Card' where payment_method = 'Debit/Credit Card';
update recurring_expenses set payment_method = 'Card' where payment_method = 'Debit/Credit Card';
