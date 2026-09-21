# GreenPeas local order desk

Private e-conomic-style sales orders, Excel overview, and pallet labels. Local only.

## Open on your PC

1. Unzip completely.
2. In `order-desk`, double-click **GreenPeas-Order-Desk.html**, or run `start-local.sh` / `start-local.bat` (starts `server.py` on http://127.0.0.1:8765).
3. Set a PIN.

Use **server.py** if you want Visma e-conomic (the browser cannot call their API from a double-clicked file).

## Orders

- **New order** — empty e-conomic canvas.
- Mix customer, product, packing and box as separate references.
- **Save** — appears in Sales orders and Excel overview.
- **Print order** — A4 order paper from the sales lines.
- **Print pallet labels** — same layout as Pallet label 2026 (From/To, delivery note, dates, lot, boxes, origin, barcode). Copies = total pallets.

## Visma e-conomic

Yes. Under **Settings & e-conomic** paste App Secret Token and Agreement Grant Token (e-conomic → Apps). Then:

- Test connection (`GET /self`)
- Pull customers
- Push the current saved order as an e-conomic **draft order**

Tokens stay in this browser. The local proxy only talks to `restapi.e-conomic.com`. Demo tokens `demo`/`demo` are GET-only.

Keep the GitHub repository private. Do not deploy this app.
