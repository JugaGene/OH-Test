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
    packing: "Excel overview",
    labels: "Pallet labels",
    settings: "Settings & e-conomic"
  };
  document.getElementById("title").textContent = titles[view] || "Order";
  const el = document.getElementById("content");
  if (view === "orders") el.innerHTML = renderList();
  else if (view === "editor") el.innerHTML = renderEditor();
  else if (view === "catalog") el.innerHTML = renderCatalog();
  else if (view === "labels") el.innerHTML = renderLabelStation();
  else if (view === "settings") el.innerHTML = renderSettings();
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
        <button class="btn" id="btnPrintOrder">Print order</button>
        <button class="btn" id="btnPrintLabels">Print pallet labels</button>
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
      gtin: (prod || {}).gtin || (prod && prod.productNo) || "",
      lot: (prod || crate || {}).lot || "",
      dessin: (prod || crate || {}).dessin || "",
      bbd: (prod || crate || {}).bbd || "",
      headline: `${qty} x ${units || ""} ${(prod || {}).productNameRaw || ""} ${(prod || {}).packingName || ""}`.replace(/\s+/g, " ").trim(),
      customerNo: sale.customerNo,
      customerId: sale.customerId,
      customerRef: sale.text1 || sale.yourRef,
      internalRef: sale.ourRef,
      orderDate: sale.date,
      deliveryDate: sale.deliveryDate,
      delivery: sale.delivery,
      address: sale.customerAddress,
      netKg: (prod || crate || {}).netKg || "",
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
    gtin: p.gtin || p.finalGtin,
    lot: p.lot,
    dessin: p.dessin,
    bbd: p.bbd,
    gln: p.gln,
    headline: `${p.boxes} x ${p.unitsPerBox} ${p.product} ${p.packing}`,
    customerNo: p.customerNo,
    customerId: p.customerId,
    customerRef: p.customerRef,
    internalRef: p.internalRef,
    orderDate: p.orderDate,
    deliveryDate: p.deliveryDate,
    delivery: p.delivery,
    address: p.address,
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
  document.getElementById("printSel")?.addEventListener("click", () => {
    const rows = allExcelRows();
    const picked = [];
    document.querySelectorAll(".lab-chk:checked").forEach((chk) => {
      const i = Number(chk.dataset.i);
      const row = { ...rows[i] };
      row.totalPallets = Number(document.querySelector(`.lab-cop[data-i="${i}"]`)?.value) || 1;
      picked.push(row);
    });
    printPalletLabels(picked);
  });
  document.getElementById("sSave")?.addEventListener("click", () => {
    const cur = loadSet();
    cur.company = {
      name: document.getElementById("sName").value,
      phone: document.getElementById("sPhone").value,
      address: document.getElementById("sAddr").value
    };
    cur.eco = {
      app: document.getElementById("sApp").value,
      grant: document.getElementById("sGrant").value
    };
    localStorage.setItem(SET_KEY, JSON.stringify(cur));
    toast("Settings saved on this PC");
  });
  const ecoStatus = (msg) => {
    const n = document.getElementById("ecoStatus");
    if (n) n.textContent = msg;
  };
  document.getElementById("sTest")?.addEventListener("click", async () => {
    try {
      const me = await ecoFetch("/self");
      ecoStatus("Connected: agreement " + (me.agreementNumber || "") + " · " + ((me.company && me.company.name) || "ok"));
    } catch (e) {
      ecoStatus("Could not reach e-conomic. Start server.py on this PC. " + e.message);
    }
  });
  document.getElementById("sPull")?.addEventListener("click", async () => {
    try {
      const data = await ecoFetch("/customers?pagesize=1000");
      const coll = data.collection || [];
      coll.forEach((c) => {
        uniqPush(state.customers, (x) => String(x.no), {
          id: String(c.customerNumber),
          no: String(c.customerNumber),
          name: c.name,
          delivery: [c.address, c.zip, c.city].filter(Boolean).join(" ")
        });
      });
      save();
      ecoStatus("Pulled " + coll.length + " customers from e-conomic");
      toast("Customers updated");
    } catch (e) {
      ecoStatus("Pull failed. " + e.message);
    }
  });
  document.getElementById("sPush")?.addEventListener("click", async () => {
    const salePush = state.activeSale || state.sales[0];
    if (!salePush || !salePush.customerNo) {
      ecoStatus("Save an order with a customer first.");
      return;
    }
    try {
      const body = {
        date: salePush.date || new Date().toISOString().slice(0, 10),
        currency: "DKK",
        customer: { customerNumber: Number(salePush.customerNo) },
        recipient: { name: salePush.customerName, address: salePush.delivery },
        references: { other: salePush.otherRef, customerContact: salePush.text1 },
        lines: (salePush.lines || []).map((l, i) => ({
          lineNumber: i + 1,
          description: l.productName,
          quantity: Number(l.quantity) || 0,
          unitNetPrice: Number(l.unitPrice) || 0
        }))
      };
      const created = await ecoFetch("/orders/drafts", { method: "POST", body: JSON.stringify(body) });
      ecoStatus("Draft order created in e-conomic: " + (created.orderNumber || JSON.stringify(created).slice(0, 80)));
    } catch (e) {
      ecoStatus("Push failed (demo tokens cannot POST). " + e.message);
    }
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
  document.getElementById("btnPrint")?.addEventListener("click", () => printOrderPaper(sale));
  document.getElementById("btnPdf")?.addEventListener("click", () => printOrderPaper(sale));
  document.getElementById("btnPrintOrder")?.addEventListener("click", () => printOrderPaper(sale));
  document.getElementById("btnPrintLabels")?.addEventListener("click", () => {
    persistHead();
    persistSale(sale);
    printPalletLabels(saleToExcelRows(sale));
  });
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

const SET_KEY = "gp.orderdesk.settings";

function loadSet() {
  try {
    return JSON.parse(localStorage.getItem(SET_KEY) || "{}");
  } catch (_) {
    return {};
  }
}

function company() {
  return Object.assign({ phone: "+45 3050 4918" }, GP_SEED.company, loadSet().company || {});
}

function compactDate(raw) {
  if (!raw) return "";
  if (/^\d{6}$/.test(raw)) return raw;
  const iso = fmtDate(raw);
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + m[2] + m[1].slice(2);
  return raw;
}

const C39 = {
  0: "nnnwwnwnn",
  1: "wnnwnnnnw",
  2: "nnwwnnnnw",
  3: "wnwwnnnnn",
  4: "nnnwwnnnw",
  5: "wnnwwnnnn",
  6: "nnwwwnnnn",
  7: "nnnwnnwnw",
  8: "wnnwnnwnn",
  9: "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  "*": "nwnnwnwnn"
};

function barcodeHtml(text) {
  const payload = ("*" + String(text || "").toUpperCase().replace(/[^0-9A-Z. -]/g, "") + "*").slice(0, 24);
  let html = '<div class="bc">';
  [...payload].forEach((ch) => {
    const pat = C39[ch] || C39[0];
    [...pat].forEach((bit) => {
      html += `<i class="${bit === "w" ? "bar w" : "bar n"}"></i>`;
    });
    html += '<i class="bar gap"></i>';
  });
  html += `</div><div class="bc-text">${esc(text)}</div>`;
  return html;
}

function openPrint(inner, kind) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Print</title>
    <style>
      body { font-family: "Segoe UI", Arial, sans-serif; margin: 0; color: #111; }
      ${kind === "label" ? labelPrintCss() : orderPrintCss()}
    </style></head><body class="${kind}">${inner}</body></html>`;
  let frame = document.getElementById("printFrame");
  if (!frame) {
    frame = document.createElement("iframe");
    frame.id = "printFrame";
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);
  }
  const doc = frame.contentWindow && frame.contentWindow.document;
  if (!doc) {
    toast("Could not open the print view");
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }, 400);
}

function labelPrintCss() {
  return `
    @page { size: A4; margin: 12mm 14mm; }
    .page { page-break-after: always; width: 170mm; min-height: 250mm; color: #111; }
    .page:last-child { page-break-after: auto; }
    .frame {
      border: 1.6px solid #111;
      padding: 8px 12px 10px;
      position: relative;
      margin: 2px 0 8px;
    }
    .frame:before, .frame:after { content: ""; position: absolute; width: 10px; height: 10px; border: 1.6px solid #111; }
    .frame:before { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }
    .frame:after { top: -1px; right: -1px; border-left: 0; border-bottom: 0; }
    .cap { font-size: 11px; margin: 8px 0 2px; }
    .from-row { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
    .from-row strong { font-size: 15px; }
    .to-name { font-size: 15px; font-weight: 700; }
    .to-addr { font-size: 13px; margin-top: 4px; }
    hr.rule { border: 0; border-top: 1.6px solid #111; margin: 10px 0 14px; }
    .dn { text-align: center; margin: 10px 0 6px; }
    .dn .t { font-size: 18px; font-weight: 700; }
    .dn .n { font-size: 20px; font-weight: 700; letter-spacing: .02em; }
    .dn .sub { margin-top: 6px; font-size: 13px; }
    .g3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px 18px; font-size: 13px; margin: 12px 0; }
    .g3 .k { font-weight: 700; }
    .g3 .v { margin-top: 2px; }
    .center-bc { text-align: center; margin-top: 18px; }
    .gs1 { text-align: center; margin: 8px 0; }
    .gs1 svg { display: block; margin: 0 auto; max-width: 150mm; }
    .gs1 .hr { font-size: 11px; margin-top: 3px; letter-spacing: .02em; }
    .meta2 { display: grid; grid-template-columns: 1.1fr 1fr; gap: 6px 24px; font-size: 13px; }
    .meta2 .k { display: inline-block; min-width: 110px; font-weight: 500; }
    .side-col { display: flex; align-items: center; gap: 8px; }
    .vert { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 14px; font-weight: 600; }
    .vert-r { writing-mode: vertical-rl; font-size: 13px; font-weight: 600; }
    .bc-wrap { display: grid; grid-template-columns: 28px 1fr 28px; align-items: center; margin-top: 10px; }
    .pl-title { font-size: 26px; font-weight: 700; text-align: center; margin: 0 0 12px; }
    .pl-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
    .pl-box { border: 1.5px solid #111; padding: 10px 12px; margin-bottom: 14px; }
    .pl-box h4 { margin: 0 0 8px; font-size: 13px; }
    .pl-box .blank { min-height: 48px; border: 1px solid #ccc; }
    .pl-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px 16px; font-size: 13px; }
    .pl-grid b { font-weight: 600; }
    .foot { display: flex; justify-content: space-between; margin-top: 24px; font-size: 12px; }
  `;
}

function addrFrames(row) {
  const co = company();
  return `
    <div class="cap">From</div>
    <div class="frame from-row"><strong>${esc(co.name)}</strong><span>${esc(co.address)}</span></div>
    <div class="cap">To</div>
    <div class="frame">
      <div class="to-name">${esc(row.customerName)}</div>
      <div class="to-addr">${esc(row.delivery)}</div>
    </div>`;
}

function padGtin(g) {
  const d = String(g || "").replace(/\D/g, "");
  if (!d) return "";
  return d.padStart(14, "0").slice(-14);
}

function gs1CheckDigit(numStr) {
  const d = String(numStr).replace(/\D/g, "");
  let sum = 0;
  let mul = 3;
  for (let i = d.length - 1; i >= 0; i--) {
    sum += Number(d[i]) * mul;
    mul = mul === 3 ? 1 : 3;
  }
  return String((10 - (sum % 10)) % 10);
}

function makeSscc(row, palletNo) {
  const gln = String(row.gln || company().gln || "15712515").replace(/\D/g, "").slice(0, 8);
  const order = String(row.orderNo || "0").replace(/\D/g, "").padStart(4, "0").slice(-4);
  const serial = String(palletNo).padStart(2, "0");
  const body = (gln + "250" + order + serial).slice(0, 17);
  return body + gs1CheckDigit(body);
}

function enrichPacking(row) {
  const r = { ...row };
  const hit = (state.packing || []).find(
    (p) =>
      String(p.orderNo) === String(r.orderNo) ||
      (p.product === r.product && p.box === r.box && p.customerName === r.customerName)
  );
  if (hit) {
    r.gtin = r.gtin || hit.gtin || hit.finalGtin;
    r.ean = r.ean || hit.ean;
    r.dessin = r.dessin || hit.dessin;
    r.lot = r.lot || hit.lot;
    r.bbd = r.bbd || hit.bbd;
    r.origin = r.origin || hit.origin;
    r.boxesPerPallet = r.boxesPerPallet || hit.boxesPerPallet;
    r.floorPallets = r.floorPallets || hit.floorPallets;
    r.totalPallets = r.totalPallets || hit.totalPallets;
    r.pallet = r.pallet || hit.pallet;
    r.unitsPerBox = r.unitsPerBox || hit.unitsPerBox;
    r.packing = r.packing || hit.packing;
    r.box = r.box || hit.box;
    r.netKg = r.netKg || hit.netKg;
    r.gln = r.gln || hit.gln;
    r.customerRef = r.customerRef || hit.customerRef;
    r.delivery = r.delivery || hit.delivery;
  }
  return r;
}

function daComma(n) {
  if (n === "" || n == null) return "";
  return String(n).replace(".", ",");
}

function deliveryNoteHtml(row) {
  const co = company();
  const units = daComma(row.unitsPerBox);
  const head = `${row.boxes} x ${units} ${row.product || ""} ${row.packing || ""}`.replace(/\s+/g, " ").trim();
  const split = Number(row.totalPallets) || "";
  const bc = typeof gpBarcodeGs1 === "function" ? gpBarcodeGs1(String(row.orderNo), 52) : "";
  return `<article class="page">
    ${addrFrames(row)}
    <hr class="rule" />
    <div class="dn">
      <div class="t">Delivery note</div>
      <div class="n">${esc(row.customerRef || row.orderNo)}</div>
      <div class="sub">${esc(head)}</div>
    </div>
    <hr class="rule" />
    <div class="g3">
      <div><div class="k">Order date</div><div class="v">${esc(compactDate(row.orderDate))}</div></div>
      <div><div class="k">Delivery date</div><div class="v">${esc(compactDate(row.deliveryDate))}</div></div>
      <div><div class="k">Order number</div><div class="v">${esc(row.orderNo)}</div></div>
      <div><div class="k">Dessin</div><div class="v">${esc(row.dessin)}</div></div>
      <div><div class="k">Order reference</div><div class="v">${esc(row.customerRef)}</div></div>
      <div><div class="k">Lot number</div><div class="v">${esc(row.lot)}</div></div>
      <div><div class="k">Total boxes</div><div class="v">${esc(row.boxes)}</div></div>
      <div><div class="k">Units per box</div><div class="v">${esc(units)}</div></div>
      <div><div class="k">Product</div><div class="v">${esc(row.product)}</div></div>
      <div><div class="k">Transport pallet</div><div class="v">${esc(row.floorPallets)}</div></div>
      <div><div class="k">Split pallet</div><div class="v">${esc(split)}</div></div>
      <div><div class="k">Pallet type</div><div class="v">${esc(row.pallet)}</div></div>
      <div><div class="k">Contact details</div><div class="v">${esc(co.phone)}</div></div>
      <div><div class="k">Origin</div><div class="v">${esc(row.origin)}</div></div>
      <div><div class="k">Net weight Kg</div><div class="v">${esc(row.netKg)}</div></div>
    </div>
    <div class="center-bc">${bc}</div>
  </article>`;
}

function gs1PalletHtml(row, palletNo, total) {
  const gtin = padGtin(row.gtin || row.ean);
  const per = Number(row.boxesPerPallet) || Number(row.boxes) || 0;
  const units = daComma(row.unitsPerBox);
  const bbd = compactDate(row.bbd || row.deliveryDate);
  const gln13 = (() => {
    const g = String(row.gln || company().gln || "1571251500001").replace(/\D/g, "");
    if (g.length >= 13) return g.slice(0, 13);
    if (g.length === 8) return (g + "00001").slice(0, 13);
    return g.padEnd(13, "0");
  })();
  const sscc = makeSscc(row, total - palletNo + 1);
  const h1 = `(02)${gtin}(37)${per}(400)${row.customerRef || ""}`;
  const h2 = `(412)${gln13}(15)${bbd}(10)${row.lot || ""}`;
  const h3 = `(00)${sscc}`;
  const desc = `${per} &nbsp; x ${units} ${esc(row.product)} ${esc(row.packing)}`;
  const b1 = typeof gpBarcodeGs1 === "function" ? gpBarcodeGs1(h1, 58) : "";
  const b2 = typeof gpBarcodeGs1 === "function" ? gpBarcodeGs1(h2, 58) : "";
  const b3 = typeof gpBarcodeGs1 === "function" ? gpBarcodeGs1(h3, 58) : "";
  return `<article class="page">
    ${addrFrames(row)}
    <hr class="rule" />
    <div class="meta2">
      <div><span class="k">Description</span> ${desc}</div>
      <div></div>
      <div><span class="k">Best before</span> ${esc(bbd)}</div>
      <div><span class="k">Dessign</span> ${esc(row.dessin)}</div>
      <div><span class="k">Order number</span> ${esc(row.orderNo)}</div>
      <div><span class="k">Order reference</span> ${esc(row.customerRef)}</div>
      <div></div>
      <div><span class="k">Delivery date</span> ${esc(compactDate(row.deliveryDate))}</div>
      <div><span class="k">GTIN</span> ${esc(gtin)}</div>
      <div><span class="k">Lot number</span> ${esc(row.lot)}</div>
      <div><span class="k">Origin</span> ${esc(row.origin)}</div>
      <div><span class="k">Quality class</span> 1</div>
    </div>
    <hr class="rule" />
    <div class="bc-wrap">
      <div class="vert">Pallet ${palletNo}/${total}</div>
      <div>${b1}${b2}<div style="display:flex;align-items:center;gap:8px"><span>SSCC</span><div style="flex:1">${b3}</div></div></div>
      <div class="vert-r">${esc(row.customerRef)}</div>
    </div>
  </article>`;
}

function packingListHtml(row) {
  const co = company();
  const bc = typeof gpBarcodeGs1 === "function" ? gpBarcodeGs1(String(row.orderNo), 40) : "";
  return `<article class="page">
    <div class="pl-head">
      <div style="font-size:12px;letter-spacing:.12em">GREEN · PEAS</div>
      <div class="pl-title">Packing list</div>
      <div style="font-size:22px;font-weight:700">${esc(row.orderNo)}</div>
    </div>
    <div class="pl-box">
      <div class="pl-grid">
        <div>Order number <b>${esc(row.orderNo)}</b></div>
        <div>Pallet type <b>${esc(row.pallet)}</b></div>
        <div>Lot number <b>${esc(row.lot)}</b></div>
        <div>Client <b>${esc(row.customerName)}</b></div>
        <div>Transport pallets <b>${esc(row.floorPallets)}</b></div>
        <div>Barcode<br/><b>${esc(row.ean)}</b></div>
        <div>Process <b>${esc(row.packing)}</b></div>
        <div>Total pallets <b>${esc(row.totalPallets)}</b></div>
        <div></div>
        <div>Product <b>${esc(row.product)}</b></div>
        <div>Box type <b>${esc(row.box)}</b></div>
        <div></div>
        <div>Packing date <b>${esc(row.orderDate)}</b></div>
        <div>Boxes per pallet <b>${esc(row.boxesPerPallet)}</b></div>
        <div></div>
        <div>Delivery date <b>${esc(compactDate(row.deliveryDate))}</b></div>
        <div>Units per box <b>${esc(daComma(row.unitsPerBox))}</b></div>
        <div>Total boxes <b>${esc(row.boxes)}</b></div>
      </div>
    </div>
    <div class="pl-box"><h4>Batches used for this order:</h4><div class="blank"></div></div>
    <div class="pl-box"><h4>Sorted kilograms:</h4><div class="blank"></div></div>
    <div class="pl-box">
      <div>Team:</div><div class="blank" style="min-height:22px;margin:6px 0"></div>
      <div>Packing line:</div><div class="blank" style="min-height:22px;margin:6px 0"></div>
      <div>Start time:</div><div class="blank" style="min-height:22px;margin:6px 0"></div>
      <div>End time:</div><div class="blank" style="min-height:22px;margin:6px 0"></div>
      <div>Time spent for sorting:</div><div class="blank" style="min-height:22px;margin:6px 0"></div>
    </div>
    <div class="foot">
      <div>${esc(co.name)}<br/>${esc(co.address)}</div>
      <div>${bc}<div style="text-align:right;font-size:20px;font-weight:700">${esc(row.orderNo)}</div></div>
    </div>
  </article>`;
}

function printPalletLabels(rows) {
  const parts = [];
  (rows || []).forEach((raw) => {
    const row = enrichPacking(raw);
    const n = Math.max(1, Number(row.totalPallets) || 1);
    parts.push(deliveryNoteHtml(row));
    for (let i = n; i >= 1; i--) parts.push(gs1PalletHtml(row, i, n));
    parts.push(packingListHtml(row));
  });
  if (!parts.length) {
    toast("No pallet rows to print");
    return;
  }
  openPrint(parts.join(""), "label");
}

function orderPrintCss() {
  return `
    @page { size: A4; margin: 14mm; }
    h1 { font-weight: 500; font-size: 22px; margin: 0 0 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
    th, td { border-bottom: 1px solid #ddd; padding: 6px 4px; text-align: left; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; font-size: 13px; }
    .tot { text-align: right; margin-top: 16px; }
  `;
}

function printOrderPaper(sale) {
  const t = saleTotals(sale);
  const lines = (sale.lines || [])
    .map(
      (l, i) =>
        `<tr><td>${i + 1}</td><td>${esc(l.productNo)}</td><td>${esc(l.productName)}</td><td>${esc(l.quantity)}</td><td>${esc(l.unit)}</td><td>${money(l.unitPrice)}</td><td>${money(lineTotal(l))}</td></tr>`
    )
    .join("");
  openPrint(
    `<h1>Order no. ${esc(sale.number || "")}</h1>
     <div class="meta">
       <div><b>${esc(sale.customerName)}</b><br/>${esc(sale.delivery)}<br/>${esc(sale.paymentTerms)} · ${esc(daDate(sale.date))}</div>
       <div>Your ref. ${esc(sale.yourRef || sale.text1)}<br/>Other ref. ${esc(sale.otherRef)}</div>
     </div>
     <table><thead><tr><th>#</th><th>Product no.</th><th>Name</th><th>Qty</th><th>Unit</th><th>Price</th><th>Total</th></tr></thead>
     <tbody>${lines}</tbody></table>
     <div class="tot">Subtotal ${money(t.sub)} · VAT ${money(t.vat)} · <b>Total ${money(t.total)} DKK</b></div>`,
    "order"
  );
}

function renderLabelStation() {
  const rows = allExcelRows();
  const body = rows
    .map((r, i) => {
      const copies = Math.max(1, Number(r.totalPallets) || 1);
      return `<tr>
        <td><input type="checkbox" class="lab-chk" data-i="${i}" checked /></td>
        <td><input class="lab-cop" data-i="${i}" type="number" min="1" value="${copies}" style="width:52px" /></td>
        <td>${esc(r.ean)}</td>
        <td>${esc(r.gtin)}</td>
        <td>${esc(r.orderNo)}</td>
        <td>${esc(r.customerName)}</td>
        <td>${esc(r.boxes)}</td>
        <td>${esc(r.floorPallets)}</td>
        <td>${esc(r.totalPallets)}</td>
        <td>${esc(r.product)}</td>
      </tr>`;
    })
    .join("");
  return `
    <div class="station">
      <div class="station-bar">
        <button class="btn save" id="printSel">Print selected labels</button>
        <span class="hint" style="padding:0">Prints the delivery note, one GS1 pallet label per pallet (4/4…1/4 with SSCC), and the packing list — same set as Pallet label 2026.</span>
      </div>
      <div class="sheet">
        <table>
          <thead><tr>
            <th></th><th>Copies</th><th>EAN</th><th>GTIN</th><th>Order no.</th>
            <th>Customer name</th><th>No of boxes</th><th>Floor pallets</th><th>Total pallets</th><th>Product</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
}

function renderSettings() {
  const s = loadSet();
  const co = company();
  const eco = s.eco || { app: "", grant: "" };
  return `
    <div class="card" style="max-width:720px">
      <h3>Company on pallet labels</h3>
      <div class="compose" style="padding:16px">
        <label>Name <input id="sName" value="${esc(co.name)}" /></label>
        <label>Phone <input id="sPhone" value="${esc(co.phone)}" /></label>
        <label style="grid-column:1/-1">Address <input id="sAddr" value="${esc(co.address)}" /></label>
      </div>
    </div>
    <div class="card" style="max-width:720px;margin-top:16px">
      <h3>Visma e-conomic</h3>
      <p class="hint">Yes — this desk can connect to Visma e-conomic on your PC only. Tokens never leave this computer. Run <code>start-local.sh</code> / <code>server.py</code> so the local proxy can call restapi.e-conomic.com (browsers block that from a double-clicked file). Create an app at e-conomic → Apps, then paste App Secret Token and Agreement Grant Token. Demo tokens <code>demo</code> / <code>demo</code> only allow GET.</p>
      <div class="compose" style="padding:16px">
        <label>App secret token <input id="sApp" type="password" value="${esc(eco.app)}" /></label>
        <label>Agreement grant token <input id="sGrant" type="password" value="${esc(eco.grant)}" /></label>
      </div>
      <div style="padding:0 16px 16px;display:flex;gap:8px">
        <button class="btn save" id="sSave">Save settings</button>
        <button class="btn" id="sTest">Test connection</button>
        <button class="btn" id="sPull">Pull customers</button>
        <button class="btn" id="sPush">Push current order as draft</button>
      </div>
      <p class="hint" id="ecoStatus"></p>
    </div>`;
}

function ecoUrl(path) {
  if (location.protocol === "http:" && location.hostname === "127.0.0.1") return "/eco" + path;
  return "https://restapi.e-conomic.com" + path;
}

async function ecoFetch(path, opts = {}) {
  const eco = loadSet().eco || {};
  const res = await fetch(ecoUrl(path), {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-AppSecretToken": eco.app || "demo",
      "X-AgreementGrantToken": eco.grant || "demo",
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { raw: text };
  }
  if (!res.ok) throw new Error((data && (data.message || data.error)) || res.status);
  return data;
}

initLock();
