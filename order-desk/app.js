const STORE = "gp.orderdesk.v3";
const PIN_KEY = "gp.orderdesk.pin";
const SESSION = "gp.orderdesk.session";

function fmtDate(raw) {
  if (!raw) return "";
  if (/^\d{2}-\d{2}-\d{2}$/.test(raw)) {
    const [m, d, y] = raw.split("-");
    return `20${y}-${m}-${d}`;
  }
  if (/^\d{6}$/.test(raw)) {
    const dd = raw.slice(0, 2), mm = raw.slice(2, 4), yy = raw.slice(4, 6);
    return `20${yy}-${mm}-${dd}`;
  }
  return raw;
}

function money(n) {
  return Number(n || 0).toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("on");
  setTimeout(() => el.classList.remove("on"), 2200);
}

async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function uniqPush(list, keyFn, item) {
  const k = keyFn(item);
  if (!k || list.some((x) => keyFn(x) === k)) return;
  list.push(item);
}

function catalogsFrom(packing) {
  const customers = [];
  const products = [];
  const packings = [];
  const boxes = [];
  const pallets = [];
  const origins = [];
  const eans = [];
  packing.forEach((p) => {
    uniqPush(customers, (c) => c.id, {
      id: p.customerId,
      no: p.customerNo,
      name: p.customerName,
      delivery: p.delivery,
      address: p.address
    });
    uniqPush(products, (x) => String(x.code), {
      code: String(p.productCode),
      name: p.product
    });
    uniqPush(packings, (x) => x.name, {
      name: p.packing,
      code: String(p.packingCode || "")
    });
    uniqPush(boxes, (x) => x.name, { name: p.box });
    if (p.pallet && !pallets.includes(p.pallet)) pallets.push(p.pallet);
    if (p.origin && !origins.includes(p.origin)) origins.push(p.origin);
    if (p.ean && !eans.includes(p.ean)) eans.push(p.ean);
  });
  return { customers, products, packings, boxes, pallets, origins, eans };
}

function uid() {
  return crypto.randomUUID();
}

function boxLabel(box) {
  if (/europool/i.test(box || "")) return "EuroPool kasse " + box.replace(/europool\s*/i, "");
  return box || "Kasse";
}

function produceLabel(productName, packingName, units, origin) {
  const u = units || "";
  return `${u} x ${packingName || ""} ${productName || ""}${origin ? ", origin " + origin : ""}`
    .replace(/\s+/g, " ")
    .trim();
}

function emptyLine() {
  return {
    id: uid(),
    productNo: "",
    productName: "",
    quantity: "",
    unit: "",
    unitPrice: 0,
    discount: 0,
    department: ""
  };
}

function linesFromPacking(p) {
  const qty = Number(p.boxes) || 0;
  return [
    {
      id: uid(),
      productNo: p.packingCode || p.box,
      productName: boxLabel(p.box),
      quantity: qty,
      unit: "Kasser",
      unitPrice: 0,
      discount: 0,
      department: ""
    },
    {
      id: uid(),
      productNo: p.ean || p.gtin || p.productCode,
      productName: produceLabel(p.product, p.packing, p.unitsPerBox, p.origin),
      quantity: qty,
      unit: "Box",
      unitPrice: 0,
      discount: 0,
      department: ""
    }
  ];
}

function saleFromPackingRows(rows) {
  const first = rows[0];
  return {
    id: uid(),
    number: first.orderNo,
    customerId: first.customerId,
    customerNo: first.customerNo,
    customerName: first.customerName,
    customerAddress: first.delivery,
    deliveryName: first.customerName,
    delivery: first.delivery,
    paymentTerms: "Netto 30 dage",
    date: fmtDate(first.orderDate),
    deliveryDate: fmtDate(first.deliveryDate),
    heading: "",
    text1: first.customerRef,
    text2: first.gtin || first.ean,
    externalId: "",
    yourRef: "",
    ourRef: "",
    ourRef2: "",
    otherRef: rows.map((r) => r.orderNo).join(", "),
    layout: "",
    currency: "DKK",
    lines: rows.flatMap(linesFromPacking)
  };
}

function salesFromPacking(packing) {
  const groups = new Map();
  packing.forEach((p) => {
    const key = p.customerId + "|" + p.deliveryDate;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  return [...groups.values()].map(saleFromPackingRows);
}

function defaultState() {
  const packing = GP_SEED.packing;
  return {
    packing,
    ...catalogsFrom(packing),
    sales: [],
    activeSale: null
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return defaultState();
}

let state = loadState();

function save() {
  localStorage.setItem(STORE, JSON.stringify(state));
}

function customerById(id) {
  return state.customers.find((c) => c.id === id);
}

function lineTotal(l) {
  const q = Number(l.quantity) || 0;
  const p = Number(l.unitPrice) || 0;
  const d = Number(l.discount) || 0;
  return q * p * (1 - d / 100);
}

function saleTotals(sale) {
  const sub = (sale.lines || []).reduce((s, l) => s + lineTotal(l), 0);
  const vat = sub * 0.25;
  return { sub, vat, total: sub + vat };
}

/* ---- lock ---- */
const lock = document.getElementById("lock");
const app = document.getElementById("app");
const pin1 = document.getElementById("pin1");
const pin2 = document.getElementById("pin2");
const lockCopy = document.getElementById("lockCopy");
const lockErr = document.getElementById("lockErr");

function showApp() {
  lock.style.display = "none";
  app.classList.add("on");
  sessionStorage.setItem(SESSION, "1");
  render();
}

function showLock(setup) {
  lock.style.display = "grid";
  app.classList.remove("on");
  pin2.classList.toggle("hidden", !setup);
  lockCopy.textContent = setup
    ? "Create a PIN known only to you. Customer, product and order data never leave this browser."
    : "Enter your PIN. This desk is local to this computer.";
}

async function initLock() {
  const existing = localStorage.getItem(PIN_KEY);
  if (sessionStorage.getItem(SESSION) === "1" && existing) {
    showApp();
    return;
  }
  showLock(!existing);
}

document.getElementById("lockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  lockErr.textContent = "";
  const existing = localStorage.getItem(PIN_KEY);
  if (!existing) {
    if ((pin1.value || "").length < 4) {
      lockErr.textContent = "PIN must be at least 4 characters.";
      return;
    }
    if (pin1.value !== pin2.value) {
      lockErr.textContent = "PINs do not match.";
      return;
    }
    localStorage.setItem(PIN_KEY, await sha(pin1.value));
    pin1.value = pin2.value = "";
    showApp();
    return;
  }
  if ((await sha(pin1.value)) !== existing) {
    lockErr.textContent = "Wrong PIN.";
    return;
  }
  pin1.value = "";
  showApp();
});

document.getElementById("btnLock").addEventListener("click", () => {
  sessionStorage.removeItem(SESSION);
  pin1.value = "";
  showLock(false);
});

/* ---- nav ---- */
let view = "orders";
document.querySelectorAll(".nav button").forEach((b) => {
  b.addEventListener("click", () => {
    view = b.dataset.view;
    document.querySelectorAll(".nav button").forEach((x) => x.classList.toggle("active", x === b));
    if (view === "new") {
      state.activeSale = blankSale();
      view = "editor";
    }
    render();
  });
});

function blankSale() {
  return {
    id: uid(),
    number: "",
    isNew: true,
    customerId: "",
    customerNo: "",
    customerName: "",
    customerAddress: "",
    deliveryName: "",
    delivery: "",
    paymentTerms: "",
    date: "",
    deliveryDate: "",
    heading: "",
    text1: "",
    text2: "",
    externalId: "",
    yourRef: "",
    ourRef: "",
    ourRef2: "",
    otherRef: "",
    layout: "",
    currency: "DKK",
    lines: []
  };
}

function daDate(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1].slice(2)}`;
}

function persistSale(sale) {
  if (!sale) return;
  if (!sale.number) {
    const nums = state.sales.map((s) => parseInt(s.number, 10)).filter((n) => n > 0);
    sale.number = String((nums.length ? Math.max(...nums) : 28000) + 1);
  }
  sale.isNew = false;
  const i = state.sales.findIndex((x) => x.id === sale.id);
  if (i >= 0) state.sales[i] = sale;
  else state.sales.unshift(sale);
  save();
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function render() {
  const titles = {
    orders: "Sales orders",
    editor: state.activeSale && state.activeSale.number && !state.activeSale.isNew
      ? "Order no. " + state.activeSale.number
      : "Order",
    catalog: "Clients, products & boxes",
    packing: "Excel overview"
  };
  document.getElementById("title").textContent = titles[view] || "Order";
  const el = document.getElementById("content");
  if (view === "orders") el.innerHTML = renderList();
  else if (view === "editor") el.innerHTML = renderEditor();
  else if (view === "catalog") el.innerHTML = renderCatalog();
  else el.innerHTML = renderOverview();
  bindView();
}

function renderList() {
  const rows = state.sales
    .map(
      (s) => `<tr class="clickable" data-open="${s.id}">
        <td>${esc(s.number)}</td>
        <td>${esc(s.customerNo)} · ${esc(s.customerName)}</td>
        <td>${esc(s.date)}</td>
        <td>${esc(s.deliveryDate)}</td>
        <td>${s.lines.length} line(s)</td>
        <td>${s.lines.reduce((n, l) => n + Number(l.quantity || 0), 0)} krt</td>
      </tr>`
    )
    .join("");
  return `
    <div class="kpi">
      <div class="card"><span>Customers</span><b>${state.customers.length}</b></div>
      <div class="card"><span>Product SKUs</span><b>${state.products.length}</b></div>
      <div class="card"><span>Boxes</span><b>${state.boxes.length}</b></div>
      <div class="card"><span>Packings</span><b>${(state.packings || []).length}</b></div>
      <div class="card"><span>Sales orders</span><b>${state.sales.length}</b></div>
    </div>
    <div class="card">
      <h3>Ready for e-conomic-style entry</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Delivery</th><th>Lines</th><th>Qty</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6">No sales orders yet</td></tr>`}</tbody>
        </table>
      </div>
      <p class="hint">Use <b>New order</b> for a blank e-conomic page. Add a customer, then add crate and product as separate lines from the catalogues — not as a fixed packing recipe.</p>
    </div>`;
}

function renderEditor() {
  const s = state.activeSale;
  if (!s) return "<p>No order selected.</p>";
  const t = saleTotals(s);
  const filled = Boolean(s.customerName);
  const title = s.number && !s.isNew ? `Order no. ${esc(s.number)}` : "Order";
  const cust = filled
    ? `<div class="cust-no">Customer no. ${esc(s.customerNo)} <span class="pencil">👍</span></div>
       <div class="cust-name" id="pickCust" style="cursor:pointer">${esc(s.customerName)}</div>
       <div class="cust-addr"><textarea id="fAddr" rows="2">${esc(s.customerAddress || s.delivery)}</textarea></div>`
    : `<button class="cust-add" id="pickCust">Add customer</button>`;
  const terms = s.paymentTerms || "";
  const dateShown = daDate(s.date);
  const delivDate = daDate(s.deliveryDate);
  const lineRows = s.lines
    .map(
      (l, i) => `<tr data-line="${l.id}">
        <td><input type="checkbox" /></td>
        <td>${i + 1}</td>
        <td><input data-f="productNo" value="${esc(l.productNo)}" /></td>
        <td><input data-f="productName" value="${esc(l.productName)}" /></td>
        <td class="num"><input data-f="quantity" type="number" step="1" value="${esc(l.quantity)}" /></td>
        <td><input data-f="unit" value="${esc(l.unit)}" /></td>
        <td class="num"><input data-f="unitPrice" type="number" step="0.01" value="${esc(l.unitPrice)}" /></td>
        <td class="num"><input data-f="discount" type="number" step="0.01" value="${esc(l.discount)}" /></td>
        <td class="num">${money(lineTotal(l))}</td>
        <td><input data-f="department" value="${esc(l.department)}" /></td>
      </tr>`
    )
    .join("");
  return `
    <div class="eco-page">
      <div class="eco-top">
        <h1>${title}</h1>
        <div class="eco-balance">Balance incl. current amount<b>${filled ? money(t.total) : ""}</b></div>
      </div>
      <div class="eco-grid">
        <div>
          ${cust}
          <div class="pair">
            <div>
              <div class="lbl">Payment terms</div>
              <div class="val ${terms ? "" : "ph"}"><input id="fTerms" placeholder="" value="${esc(terms)}" /></div>
            </div>
            <div>
              <div class="lbl">Date</div>
              <div class="val ${s.date ? "" : "ph"}"><input id="fDate" type="date" value="${esc(s.date)}" /></div>
            </div>
          </div>
          <div style="margin-top:16px">
            <div class="lbl">Delivery</div>
            ${
              filled
                ? `<div class="val"><input id="fDelName" value="${esc(s.deliveryName || s.customerName)}" /></div>
                   <div class="val"><input id="fDeliv" value="${esc(s.delivery)}" /></div>
                   <div class="val ${s.deliveryDate ? "" : "ph"}"><input id="fDelDate" type="date" value="${esc(s.deliveryDate)}" /></div>`
                : `<div class="val ph">Address</div>
                   <div class="val ph">Delivery terms and date</div>
                   <input id="fDelName" type="hidden" />
                   <input id="fDeliv" type="hidden" />
                   <input id="fDelDate" type="hidden" />`
            }
          </div>
        </div>
        <div class="notes">
          <div class="notes-title">Notes and references</div>
          ${[
            ["Heading", "fHead", s.heading],
            ["Text 1", "fT1", s.text1],
            ["Text 2", "fT2", s.text2],
            ["External Id", "fExt", s.externalId],
            ["Your ref.", "fYref", s.yourRef],
            ["Our ref.", "fOref", s.ourRef],
            ["Our ref. 2", "fOref2", s.ourRef2],
            ["Other ref.", "fXref", s.otherRef]
          ]
            .map(
              ([lab, id, val]) =>
                `<div class="nrow"><span>${lab}</span><input id="${id}" value="${esc(val)}" /></div>`
            )
            .join("")}
          <div class="attach">Attached documents</div>
        </div>
        <div>
          <div class="eco-right">
            <div class="show-order" id="btnPrint"><span>🔍 Show order</span></div>
            <div class="totals">
              <div class="trow"><span>Subtotal</span><span>${money(t.sub)}</span></div>
              <div class="trow"><span>VAT</span><span>${money(t.vat)}</span></div>
              <div class="trow"><span>Margin</span><span>${money(t.sub)} (100%)</span></div>
              <div class="total"><span>Total <span class="dkk">${esc(s.currency)}</span></span><span>${money(t.total)}</span></div>
            </div>
          </div>
          <div class="layout-line">Layout: <input id="fLay" value="${esc(s.layout)}" placeholder="" /></div>
        </div>
      </div>
      <div class="eco-actions">
        <button class="btn primary" id="btnNewLine">New order line</button>
        <button class="btn save" id="btnKeep">Save</button>
        ${filled ? `<button class="btn" id="btnSend">Send order</button>` : ""}
        <button class="btn" id="btnSave">Convert to invoice</button>
        <button class="btn">More ▾</button>
        <div class="right">
          <button class="ico" id="btnPdf" title="Print">🖨</button>
          <span>${s.lines.length} item(s) in total</span>
        </div>
      </div>
      <div class="eco-lines">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Line no.</th>
              <th>Product no.</th>
              <th>Product name</th>
              <th>Quantity</th>
              <th>Unit</th>
              <th>Unit price</th>
              <th>Discount (%)</th>
              <th>Total</th>
              <th>Afdeling</th>
            </tr>
          </thead>
          <tbody>${lineRows}</tbody>
        </table>
        <div class="line-foot">${s.lines.length} item(s) in total</div>
      </div>
    </div>`;
}

function renderCatalog() {
  const cRows = state.customers
    .map(
      (c) => `<tr><td>${esc(c.no)}</td><td>${esc(c.id)}</td><td>${esc(c.name)}</td><td>${esc(c.delivery)}</td></tr>`
    )
    .join("");
  const pRows = state.products
    .map((p) => `<tr><td>${esc(p.code)}</td><td>${esc(p.name)}</td></tr>`)
    .join("");
  const packRows = (state.packings || [])
    .map((p) => `<tr><td>${esc(p.code)}</td><td>${esc(p.name)}</td></tr>`)
    .join("");
  const boxRows = (state.boxes || [])
    .map((b) => `<tr><td>${esc(b.name)}</td></tr>`)
    .join("");
  const palRows = (state.pallets || []).map((p) => `<tr><td>${esc(p)}</td></tr>`).join("");
  const originRows = (state.origins || []).map((p) => `<tr><td>${esc(p)}</td></tr>`).join("");
  return `
    <div class="card" style="margin-bottom:16px">
      <h3>Customers (${state.customers.length})</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Customer no.</th><th>Customer ID</th><th>Name</th><th>Delivery address</th></tr></thead>
        <tbody>${cRows}</tbody>
      </table></div>
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card">
        <h3>Products (${state.products.length})</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Product no.</th><th>Name</th></tr></thead>
          <tbody>${pRows}</tbody>
        </table></div>
      </div>
      <div class="card">
        <h3>Packing (${(state.packings || []).length})</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Packing code</th><th>Packing name</th></tr></thead>
          <tbody>${packRows}</tbody>
        </table></div>
      </div>
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="card">
        <h3>Boxes (${(state.boxes || []).length})</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Box name</th></tr></thead>
          <tbody>${boxRows}</tbody>
        </table></div>
      </div>
      <div class="card">
        <h3>Pallets (${(state.pallets || []).length})</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Pallet</th></tr></thead>
          <tbody>${palRows}</tbody>
        </table></div>
      </div>
    </div>
    <div class="card">
      <h3>Origins (${(state.origins || []).length})</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Origin</th></tr></thead>
        <tbody>${originRows}</tbody>
      </table></div>
      <p class="hint">These lists are independent. Mix any customer with any product, packing and box when you build an order.</p>
    </div>`;
}

function saleToExcelRows(sale) {
  const rows = [];
  const lines = sale.lines || [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1];
    let crate = null;
    let prod = null;
    if (l.unit === "Kasser" && next && next.unit === "Box") {
      crate = l;
      prod = next;
      i += 1;
    } else if (l.unit === "Box") prod = l;
    else crate = l;
    const qty = Number((crate || prod).quantity) || 0;
    const bpp = Number((crate || prod).boxesPerPallet) || 0;
    const units = Number((prod || crate || {}).unitsPerBox) || "";
    rows.push({
      source: "Saved",
      orderNo: sale.number,
      customerName: sale.customerName,
      boxes: qty,
      floorPallets: bpp ? 1 : "",
      totalPallets: bpp ? Math.ceil(qty / bpp) : "",
      pallet: (crate || prod).pallet || "",
      boxesPerPallet: bpp || "",
      box: (crate || prod).boxName || (crate && crate.productName) || "",
      unitsPerBox: units,
      packing: (prod || {}).packingName || "",
      packingCode: (crate || prod).packingCode || "",
      product: (prod || {}).productNameRaw || (prod && prod.productName) || "",
      productCode: (prod || {}).productCode || "",
      origin: (prod || crate || {}).origin || "",
      ean: (prod && prod.productNo) || "",
      customerNo: sale.customerNo,
      customerId: sale.customerId,
      customerRef: sale.text1 || sale.yourRef,
      internalRef: sale.ourRef,
      orderDate: sale.date,
      deliveryDate: sale.deliveryDate,
      delivery: sale.delivery,
      address: sale.customerAddress,
      lot: "",
      netKg: "",
      description: prod ? prod.productName : (crate && crate.productName) || ""
    });
  }
  return rows;
}

function packingToExcelRow(p) {
  return {
    source: "Excel",
    orderNo: p.orderNo,
    customerName: p.customerName,
    boxes: p.boxes,
    floorPallets: p.floorPallets,
    totalPallets: p.totalPallets,
    pallet: p.pallet,
    boxesPerPallet: p.boxesPerPallet,
    box: p.box,
    unitsPerBox: p.unitsPerBox,
    packing: p.packing,
    packingCode: p.packingCode,
    product: p.product,
    productCode: p.productCode,
    origin: p.origin,
    ean: p.ean,
    customerNo: p.customerNo,
    customerId: p.customerId,
    customerRef: p.customerRef,
    internalRef: p.internalRef,
    orderDate: p.orderDate,
    deliveryDate: p.deliveryDate,
    delivery: p.delivery,
    address: p.address,
    lot: p.lot,
    netKg: p.netKg,
    description: p.description
  };
}

function allExcelRows() {
  const saved = (state.sales || []).flatMap(saleToExcelRows);
  const imported = (state.packing || []).map(packingToExcelRow);
  return saved.concat(imported);
}

function renderOverview() {
  const cols = [
    ["source", "Source"],
    ["orderNo", "Order no."],
    ["customerName", "Customer name"],
    ["customerNo", "Customer no."],
    ["customerId", "Customer ID"],
    ["boxes", "No of boxes"],
    ["floorPallets", "Floor pallets"],
    ["totalPallets", "Total pallets"],
    ["pallet", "Pallet name"],
    ["boxesPerPallet", "Boxes per pallet"],
    ["box", "Box name"],
    ["unitsPerBox", "Units per box"],
    ["packing", "Packing name"],
    ["packingCode", "Packing code"],
    ["product", "Product name"],
    ["productCode", "Product code"],
    ["origin", "Origin"],
    ["ean", "EAN"],
    ["lot", "Lot no."],
    ["orderDate", "Order date"],
    ["deliveryDate", "Delivery date"],
    ["customerRef", "Customer reference"],
    ["internalRef", "Internal reference"],
    ["delivery", "Delivery address"],
    ["address", "Address"],
    ["netKg", "Net weight in Kg"],
    ["description", "Final description"]
  ];
  const data = allExcelRows();
  const body = data
    .map((r) => {
      const cls = r.source === "Saved" ? "saved-row" : "";
      return `<tr class="${cls}">${cols
        .map(([k]) => `<td>${esc(r[k] ?? "")}</td>`)
        .join("")}</tr>`;
    })
    .join("");
  return `
    <div class="sheet-wrap">
      <div class="sheet-head">
        <strong>Order handling overview</strong>
        <span>${data.filter((r) => r.source === "Saved").length} saved · ${
          data.filter((r) => r.source === "Excel").length
        } from Excel</span>
      </div>
      <div class="sheet">
        <table>
          <thead><tr>${cols.map(([, lab]) => `<th>${lab}</th>`).join("")}</tr></thead>
          <tbody>${body || `<tr><td colspan="${cols.length}">No rows yet — save an order.</td></tr>`}</tbody>
        </table>
      </div>
      <p class="hint">Saved e-conomic orders appear here in the same columns as the Excel file, plus the original imported rows.</p>
    </div>`;
}

function bindView() {
  document.querySelectorAll("[data-open]").forEach((tr) => {
    tr.addEventListener("click", () => {
      state.activeSale = state.sales.find((s) => s.id === tr.dataset.open);
      view = "editor";
      document.querySelectorAll(".nav button").forEach((x) => x.classList.remove("active"));
      render();
    });
  });
  const sale = state.activeSale;
  if (view !== "editor" || !sale) return;

  const persistHead = () => {
    const g = (id) => document.getElementById(id)?.value ?? "";
    sale.paymentTerms = g("fTerms");
    sale.date = g("fDate");
    sale.customerAddress = g("fAddr") || sale.customerAddress;
    sale.deliveryName = g("fDelName") || sale.deliveryName;
    sale.delivery = g("fDeliv") || sale.delivery;
    sale.deliveryDate = g("fDelDate") || sale.deliveryDate;
    sale.heading = g("fHead");
    sale.text1 = g("fT1");
    sale.text2 = g("fT2");
    sale.externalId = g("fExt");
    sale.yourRef = g("fYref");
    sale.ourRef = g("fOref");
    sale.ourRef2 = g("fOref2");
    sale.otherRef = g("fXref");
    sale.layout = g("fLay");
    if (!sale.isNew) persistSale(sale);
  };
  [
    "fTerms", "fDate", "fAddr", "fDelName", "fDeliv", "fDelDate",
    "fHead", "fT1", "fT2", "fExt", "fYref", "fOref", "fOref2", "fXref", "fLay"
  ].forEach((id) => {
    const n = document.getElementById(id);
    if (n) n.addEventListener("change", persistHead);
  });
  document.querySelectorAll("tr[data-line] input").forEach((inp) => {
    inp.addEventListener("change", () => {
      const id = inp.closest("tr").dataset.line;
      const line = sale.lines.find((l) => l.id === id);
      const f = inp.dataset.f;
      line[f] = inp.type === "number" ? Number(inp.value) : inp.value;
      if (!sale.isNew) persistSale(sale);
      render();
    });
  });
  document.querySelectorAll("[data-del]").forEach((b) => {
    b.addEventListener("click", () => {
    sale.lines = sale.lines.filter((l) => l.id !== b.dataset.del);
    if (!sale.isNew) persistSale(sale);
    render();
    });
  });
  document.getElementById("pickCust")?.addEventListener("click", pickCustomer);
  document.getElementById("btnNewLine")?.addEventListener("click", pickProduct);
  const saveNow = () => {
    persistHead();
    persistSale(sale);
    toast("Saved on this PC");
    render();
  };
  const saveAndList = () => {
    persistHead();
    persistSale(sale);
    toast("Saved — shown in Sales orders and Overview");
    view = "orders";
    document.querySelectorAll(".nav button").forEach((x) => x.classList.toggle("active", x.dataset.view === "orders"));
    render();
  };
  document.getElementById("btnKeep")?.addEventListener("click", saveAndList);
  document.getElementById("btnSave")?.addEventListener("click", saveNow);
  document.getElementById("btnSend")?.addEventListener("click", saveNow);
  document.getElementById("btnPrint")?.addEventListener("click", () => window.print());
  document.getElementById("btnPdf")?.addEventListener("click", () => window.print());
}

function openModal(html, after) {
  const bg = document.getElementById("modalBg");
  bg.classList.add("on");
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.querySelector(".modal").addEventListener("click", (e) => e.stopPropagation());
  bg.onclick = () => bg.classList.remove("on");
  after?.(bg);
}

function pickCustomer() {
  openModal(
    `<h3>Customers</h3><input class="search" id="q" placeholder="Search name, number, ID…" />
     <div class="table-wrap"><table><tbody id="pickBody"></tbody></table></div>`,
    (bg) => {
      const draw = () => {
        const q = (bg.querySelector("#q").value || "").toLowerCase();
        bg.querySelector("#pickBody").innerHTML = state.customers
          .filter((c) => `${c.name} ${c.no} ${c.id}`.toLowerCase().includes(q))
          .map(
            (c) => `<tr class="clickable" data-id="${esc(c.id)}"><td>${esc(c.no)}</td><td>${esc(c.id)}</td><td>${esc(c.name)}</td><td>${esc(c.delivery)}</td></tr>`
          )
          .join("");
        bg.querySelectorAll("[data-id]").forEach((tr) => {
          tr.onclick = () => {
            const c = customerById(tr.dataset.id);
            Object.assign(state.activeSale, {
              customerId: c.id,
              customerNo: c.no,
              customerName: c.name,
              customerAddress: c.delivery,
              deliveryName: c.name,
              delivery: c.delivery,
              paymentTerms: state.activeSale.paymentTerms || "Netto 30 dage",
              date: state.activeSale.date || new Date().toISOString().slice(0, 10)
            });
            bg.classList.remove("on");
            render();
          };
        });
      };
      bg.querySelector("#q").oninput = draw;
      draw();
    }
  );
}

function options(list, valueFn, labelFn) {
  return list
    .map((item) => {
      const v = valueFn(item);
      const l = labelFn(item);
      return `<option value="${esc(v)}">${esc(l)}</option>`;
    })
    .join("");
}

function pickProduct() {
  const products = state.products || [];
  const packings = state.packings || [];
  const boxes = state.boxes || [];
  const pallets = state.pallets || [];
  const origins = state.origins || [];
  const eans = state.eans || [];
  openModal(
    `<h3>New order line</h3>
     <p class="hint" style="padding:0 0 12px">Pick each reference on its own. Add a crate line, a product line, or both.</p>
     <div class="compose">
       <label>Kind
         <select id="cKind">
           <option value="box">Crate / box (Kasser)</option>
           <option value="product">Product (Box)</option>
           <option value="both">Crate and product as two lines</option>
         </select>
       </label>
       <label>Box
         <select id="cBox"><option value="">—</option>${options(boxes, (b) => b.name, (b) => b.name)}</select>
       </label>
       <label>Product
         <select id="cProd"><option value="">—</option>${options(products, (p) => p.code, (p) => p.code + " · " + p.name)}</select>
       </label>
       <label>Packing
         <select id="cPack"><option value="">—</option>${options(packings, (p) => p.name, (p) => (p.code ? p.code + " · " : "") + p.name)}</select>
       </label>
       <label>Origin
         <select id="cOrig"><option value="">—</option>${origins.map((o) => `<option>${esc(o)}</option>`).join("")}</select>
       </label>
       <label>Pallet
         <select id="cPal"><option value="">—</option>${pallets.map((o) => `<option>${esc(o)}</option>`).join("")}</select>
       </label>
       <label>Boxes per pallet
         <input id="cBpp" type="number" step="1" value="" />
       </label>
       <label>Units per box
         <input id="cUnits" type="number" step="1" value="10" />
       </label>
       <label>Quantity
         <input id="cQty" type="number" step="1" value="1" />
       </label>
       <label>Product no. (optional override)
         <select id="cEan"><option value="">Use product / box code</option>${eans.map((o) => `<option>${esc(o)}</option>`).join("")}</select>
       </label>
     </div>
     <button class="btn primary" id="cAdd" type="button">Add to order</button>`,
    (bg) => {
      bg.querySelector("#cAdd").onclick = () => {
        const kind = bg.querySelector("#cKind").value;
        const boxName = bg.querySelector("#cBox").value;
        const prodCode = bg.querySelector("#cProd").value;
        const packName = bg.querySelector("#cPack").value;
        const origin = bg.querySelector("#cOrig").value;
        const pallet = bg.querySelector("#cPal").value;
        const bpp = Number(bg.querySelector("#cBpp").value) || 0;
        const units = Number(bg.querySelector("#cUnits").value) || 0;
        const qty = Number(bg.querySelector("#cQty").value) || 0;
        const ean = bg.querySelector("#cEan").value;
        const product = products.find((p) => String(p.code) === String(prodCode));
        const packing = packings.find((p) => p.name === packName);
        const sale = state.activeSale;
        if (kind === "box" || kind === "both") {
          if (!boxName) {
            toast("Choose a box");
            return;
          }
          sale.lines.push({
            id: uid(),
            productNo: (packing && packing.code) || boxName,
            productName: boxLabel(boxName),
            quantity: qty,
            unit: "Kasser",
            unitPrice: 0,
            discount: 0,
            department: "",
            boxName,
            packingCode: packing ? packing.code : "",
            pallet,
            boxesPerPallet: bpp
          });
        }
        if (kind === "product" || kind === "both") {
          if (!product) {
            toast("Choose a product");
            return;
          }
          sale.lines.push({
            id: uid(),
            productNo: ean || product.code,
            productName: produceLabel(product.name, packName, units, origin),
            quantity: qty,
            unit: "Box",
            unitPrice: 0,
            discount: 0,
            department: "",
            boxName,
            packingName: packName,
            packingCode: packing ? packing.code : "",
            productNameRaw: product.name,
            productCode: product.code,
            origin,
            unitsPerBox: units,
            pallet,
            boxesPerPallet: bpp
          });
        }
        if (!sale.isNew) persistSale(sale);
        bg.classList.remove("on");
        render();
      };
    }
  );
}

document.getElementById("btnImport").addEventListener("click", () => document.getElementById("fileCsv").click());
document.getElementById("fileCsv").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const packing = parseCsv(text);
  if (!packing.length) {
    toast("No order rows found");
    return;
  }
  state.packing = packing;
  Object.assign(state, catalogsFrom(packing));
  save();
  toast("Catalogues updated locally — " + packing.length + " packing rows");
  view = "orders";
  render();
  e.target.value = "";
});

function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  let headerIdx = lines.findIndex((l) => l.toLowerCase().includes("order no") && l.toLowerCase().includes("customer"));
  if (headerIdx < 0) headerIdx = 0;
  const split = (row) => row.split(";").map((c) => c.trim());
  const headers = split(lines[headerIdx]);
  const idx = (name) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const packing = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = split(lines[i]);
    if (!cols[0] || !/^\d+$/.test(cols[0])) continue;
    const g = (n) => cols[idx(n)] || "";
    packing.push({
      orderNo: g("Order no."),
      customerName: g("Customer name"),
      boxes: Number(g("No of boxes")) || 0,
      floorPallets: Number(g("Floor pallets")) || 0,
      totalPallets: Number(g("Total pallets")) || 0,
      pallet: g("Pallet name"),
      boxesPerPallet: Number(g("Boxes per pallet")) || 0,
      box: g("Box name"),
      unitsPerBox: Number(g("Units per box")) || 0,
      packing: g("Packing name"),
      product: g("Product name"),
      lot: g("Lot no."),
      orderDate: g("Order date"),
      packingDate: g("Packing date"),
      deliveryDate: g("Delivery date"),
      internalRef: g("Internal reference"),
      customerRef: g("Customer reference"),
      customerNo: g("Customer no."),
      customerId: String(g("Customer ID")).replace(/\.$/, ""),
      packingCode: String(Number(g("Packing  code") || g("Packing code")) || ""),
      origin: g("Origin"),
      productCode: String(Number(g("Product code")) || g("Product code")),
      ean: g("EAN"),
      gtin: g("GTIN"),
      finalGtin: g("Final GTIN"),
      sscc: g("SSCC"),
      warehouseNo: String(Number(g("Warehouse no.")) || 1),
      shipFrom: g("Departure warehouse"),
      address: g("Address"),
      delivery: g("Delivery address"),
      bbd: g("Best before"),
      description: g("Final description"),
      dessin: g("Dessin"),
      netKg: Number(g("Net weight in Kg")) || 0,
      packingDay: g("Packing day no.")
    });
  }
  return packing;
}

initLock();
