# GreenPeas local order desk

Private **e-conomic-style sales order** page for packing data. It is not a spreadsheet and it is not a public website.

## Privacy

- Runs only on **your PC** (`127.0.0.1`). It does not listen on the network.
- After you set a PIN, the desk stays locked until you unlock it in this browser.
- Orders you edit are stored in **this browser’s local storage**. Nothing is uploaded.
- Keep this GitHub repository **private**. The catalogue is copied from your order-handling export so you can test offline.

Do **not** host this on Render, Vercel, or any public URL.

## Open on your PC

1. Copy the `order-desk` folder to the machine.
2. On Windows, double-click `start-local.bat`. On Mac/Linux: `chmod +x start-local.sh && ./start-local.sh`.
3. Open [http://127.0.0.1:8765](http://127.0.0.1:8765).
4. Create a PIN (min. 4 characters). Use it only on this computer.

You need Python 3 (already on most Macs; on Windows install from python.org and tick “Add to PATH”).

## What it does

Packing rows (customer, product, box, pallet, EAN, lot, SSCC…) are mapped to **sales order lines** like e-conomic:

Line no. · Product no. · Product name · Quantity · Unit · Unit price · Discount · Total · Afdeling

Each line still shows box, packing, pallet, EAN, lot and SSCC underneath so you do not retype logistics into a sheet.

Unit prices are `0,00` until you type them (they were not in the export).

## Import another export

Use **Import CSV** (semicolon-separated, same columns as the order-handling file). Parsing happens in the browser; the file is not sent anywhere.
