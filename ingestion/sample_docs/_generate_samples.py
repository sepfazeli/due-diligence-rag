"""
Generate synthetic sample PDFs for end-to-end testing (DEV-ONLY).

These are committed to the repo so you can test ingestion without real data.
Re-generate them only if you want to change the fixtures:

    pip install reportlab        # not part of the pipeline's requirements.txt
    python _generate_samples.py

Creates: financials.pdf, seller_disclosure.pdf, listing.pdf

The documents describe a fictional business (ACME Roasters LLC) and deliberately
contain material that exercises the RAG: a gridded financial table, declining
EBITDA, customer concentration, a pending lawsuit, debt maturity, lease expiry.
"""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = Path(__file__).resolve().parent
_styles = getSampleStyleSheet()
TITLE = ParagraphStyle("T", parent=_styles["Title"], fontSize=16)
HEAD = ParagraphStyle("H", parent=_styles["Heading2"], spaceBefore=14, spaceAfter=6)
BODY = ParagraphStyle("B", parent=_styles["BodyText"], spaceAfter=6, leading=14)


def build(filename: str, flowables: list) -> None:
    SimpleDocTemplate(
        str(OUT / filename), pagesize=LETTER, topMargin=0.8 * inch, bottomMargin=0.8 * inch
    ).build(flowables)
    print("wrote", filename)


def H(text: str) -> Paragraph:
    return Paragraph(text.upper(), HEAD)  # uppercase so the ingester detects headings


def P(text: str) -> Paragraph:
    return Paragraph(text, BODY)


def income_statement_table() -> Table:
    data = [
        ["Line Item ($000s)", "FY2023", "FY2024", "FY2025"],
        ["Revenue", "1,200", "1,450", "1,520"],
        ["Cost of Goods Sold", "540", "690", "790"],
        ["Gross Profit", "660", "760", "730"],
        ["Operating Expenses", "410", "480", "560"],
        ["EBITDA", "250", "280", "170"],
        ["Net Income", "180", "195", "95"],
    ]
    t = Table(data, hAlign="LEFT", colWidths=[2.4 * inch, 1.0 * inch, 1.0 * inch, 1.0 * inch])
    t.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ]
        )
    )
    return t


# ── financials.pdf ──────────────────────────────────────────────────────────────
build(
    "financials.pdf",
    [
        Paragraph("ACME Roasters LLC — Financial Statements", TITLE),
        Spacer(1, 12),
        H("Income Statement"),
        P(
            "The following summarizes operating results for fiscal years 2023 through "
            "2025. Figures are in thousands of USD and are unaudited management accounts."
        ),
        Spacer(1, 6),
        income_statement_table(),
        Spacer(1, 12),
        H("Notes to Financials"),
        P(
            "Revenue grew approximately 26.7% from FY2023 to FY2025. However, EBITDA "
            "declined to $170k in FY2025 from $280k in FY2024 as cost of goods sold and "
            "operating expenses rose faster than sales. Gross margin compressed from 55% "
            "in FY2023 to 48% in FY2025."
        ),
        P(
            "One customer, BigCorp Foods, accounted for approximately 38% of FY2025 "
            "revenue. The company carries $220k of outstanding term debt maturing in "
            "March 2026."
        ),
        P(
            "Owner's compensation of $95k is included in operating expenses and may be "
            "partially add-back adjustable for a new owner."
        ),
    ],
)

# ── seller_disclosure.pdf ─────────────────────────────────────────────────────────
build(
    "seller_disclosure.pdf",
    [
        Paragraph("ACME Roasters LLC — Seller's Disclosure Statement", TITLE),
        Spacer(1, 12),
        H("Reason for Sale"),
        P(
            "The owner is retiring after 10 years and wishes to transition the business "
            "to a new operator. The owner is willing to provide up to 8 weeks of "
            "transition support."
        ),
        H("Legal and Compliance"),
        P(
            "There is one pending legal matter: a former employee filed a "
            "wrongful-termination claim in late 2025 seeking approximately $50,000. The "
            "company disputes the claim. All business licenses and food-handling permits "
            "are current."
        ),
        H("Customer Concentration"),
        P(
            "A single wholesale customer, BigCorp Foods, represented roughly 38% of "
            "revenue in FY2025. Loss of this account would materially affect revenue."
        ),
        H("Lease and Premises"),
        P(
            "The roastery operates from a leased 4,000 sq ft facility. The current lease "
            "expires in December 2026; renewal terms have not yet been negotiated with "
            "the landlord."
        ),
        H("Outstanding Liabilities"),
        P(
            "The business has $220,000 in term debt maturing March 2026 and approximately "
            "$30,000 in trade payables. There are no known tax liens."
        ),
    ],
)

# ── listing.pdf ───────────────────────────────────────────────────────────────────
build(
    "listing.pdf",
    [
        Paragraph("Business For Sale — Specialty Coffee Roaster", TITLE),
        Spacer(1, 12),
        H("Business Overview"),
        P(
            "ACME Roasters LLC is a specialty coffee roasting and wholesale business "
            "founded in 2015, based in Portland, Oregon. The company sells to cafes, "
            "offices, and one large wholesale account, and employs 12 staff."
        ),
        H("Asking Price"),
        P(
            "The asking price is $650,000, which includes equipment, inventory, and brand "
            "assets. The price represents approximately 3.8x FY2025 EBITDA."
        ),
        H("Included Assets"),
        P(
            "Included: two commercial roasters, packaging equipment, a delivery van, "
            "$40,000 of green coffee inventory, customer relationships, and the ACME "
            "Roasters brand and website."
        ),
        H("Financing"),
        P(
            "The seller is open to financing up to 20% of the purchase price for a "
            "qualified buyer over 36 months."
        ),
        H("Growth Opportunities"),
        P(
            "Potential to expand direct-to-consumer online sales, add subscription "
            "offerings, and diversify the wholesale customer base to reduce concentration "
            "risk."
        ),
    ],
)
