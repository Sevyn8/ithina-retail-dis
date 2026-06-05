"""Authored operator-facing labels for the field catalog — merged by key, never structural.

STRUCTURE (keys, mandatory-ness, datatypes, allowed values) is DERIVED from the
canonical models + the dis-validation provenance partition in
``field_catalog.py``; this module authors only what code cannot derive: the
display name and the operator-facing description. The builder's both-directions
drift check (``FieldCatalogDriftError``, fails boot) keeps this dict honest: a
new mapping-produced canonical column without a label here refuses to start, as
does a label whose column is gone.

Keyed by section (the routed event model's wire label) then canonical column
name, because a column like ``sku_id`` is a distinct operator decision per
template kind and may warrant different guidance.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FieldLabel:
    """The authored half of one catalog entry."""

    display_name: str
    description: str


LABELS: dict[str, dict[str, FieldLabel]] = {
    "sale_event": {
        "event_date": FieldLabel(
            "Event date",
            "Calendar date of the sale at UTC, derived from the sale timestamp "
            "(use a date_from_datetime derive on the timestamp column).",
        ),
        "sku_id": FieldLabel("SKU", "The product identifier as your system reports it."),
        "sku_variant": FieldLabel(
            "SKU variant", "Variant qualifier (size, colour) when your SKUs carry one."
        ),
        "sku_lot_batch": FieldLabel("Lot / batch", "Lot or batch number when tracked."),
        "event_subtype": FieldLabel("Sale type", "Whether the line is a sale, a return, or a void."),
        "source_sale_timestamp": FieldLabel(
            "Sale timestamp",
            "When the sale happened, per your system's clock. Declare the exact "
            "format and timezone — they are never guessed.",
        ),
        "transaction_id": FieldLabel(
            "Transaction ID", "Your receipt/transaction reference; enables exact correction matching."
        ),
        "line_item_seq": FieldLabel("Line number", "Position of this line within the transaction."),
        "quantity": FieldLabel("Quantity", "Units sold (negative or RETURN-typed rows represent returns)."),
        "unit_retail_price": FieldLabel("Unit retail price", "Listed shelf price per unit at sale time."),
        "unit_sale_price": FieldLabel("Unit sale price", "Price per unit actually charged after discounts."),
        "discount_amount": FieldLabel("Discount amount", "Absolute discount applied to the line."),
        "discount_pct": FieldLabel("Discount %", "Percentage discount applied to the line."),
        "unit_cost": FieldLabel("Unit cost", "Your cost per unit, when the source reports it."),
        "promo_identifier": FieldLabel("Promotion ID", "Identifier of the promotion applied, if any."),
        "tax_amount": FieldLabel("Tax amount", "Tax charged on the line."),
        "currency": FieldLabel(
            "Currency",
            "ISO 4217 code (e.g. EUR). If the file has no currency column, provide it as a constant derive.",
        ),
        "payment_method": FieldLabel("Payment method", "How the transaction was paid (cash, card, ...)."),
        "customer_token": FieldLabel(
            "Customer token",
            "Tokenized customer reference. Raw identifiers are tokenized at the "
            "receiver before this column is ever populated.",
        ),
        "sale_channel": FieldLabel("Sale channel", "Originating channel (in-store, online, ...)."),
    },
    "change_event": {
        "event_date": FieldLabel(
            "Event date",
            "Calendar date of the change at UTC, derived from the event timestamp "
            "(use a date_from_datetime derive on the timestamp column).",
        ),
        "sku_id": FieldLabel("SKU", "The product identifier as your system reports it."),
        "sku_variant": FieldLabel(
            "SKU variant", "Variant qualifier (size, colour) when your SKUs carry one."
        ),
        "sku_lot_batch": FieldLabel("Lot / batch", "Lot or batch number when tracked."),
        "event_category": FieldLabel(
            "Change category",
            "What kind of change this template carries (inventory, price, cost, ...). "
            "Usually a constant derive per template.",
        ),
        "event_subtype": FieldLabel("Change subtype", "Your finer-grained change label (free-form)."),
        "source_event_timestamp": FieldLabel(
            "Change timestamp",
            "When the change happened, per your system's clock. Declare the exact "
            "format and timezone — they are never guessed.",
        ),
        "effective_from": FieldLabel("Effective from", "When the new value takes effect, if scheduled."),
        "effective_until": FieldLabel("Effective until", "When the value expires, if bounded."),
        "attribute_name": FieldLabel(
            "Attribute",
            "Which attribute changed (e.g. stock_qty, current_retail_price). "
            "Usually a constant derive per template.",
        ),
        "value_before": FieldLabel(
            "Value before", "The attribute's value before the change, when the source reports it."
        ),
        "value_after": FieldLabel("Value after", "The attribute's value after the change."),
        "reason_code": FieldLabel("Reason code", "Your system's code for why the change happened."),
        "reason_note": FieldLabel("Reason note", "Free-text note accompanying the change."),
        "change_context": FieldLabel(
            "Change context", "Additional structured context your system attaches to the change."
        ),
    },
}
