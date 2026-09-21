const STORE = "gp.orderdesk.v2";
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

function catalogsFrom(packing) {
  const customers = [];
  const seenC = new Set();
  packing.forEach((p) => {
    const key = p.customerId + "|" + p.customerName;
    if (seenC.has(key)) return;
    seenC.add(key);
    customers.push({
      id: p.customerId,
      no: p.customerNo,
      name: p.customerName,
      delivery: p.delivery,
      address: p.address,
      gln: p.gln || window.GP_SEED.company.gln
    });
  });
  const products = [];
  const seenP = new Set();
  packing.forEach((p) => {
    const key = [p.productCode, p.ean, p.box, p.packing].join("|");
    if (seenP.has(key)) return;
    seenP.add(key);
    products.push({
      code: String(p.productCode),
      name: p.product,
      packing: p.packing,
      packingCode: String(p.packingCode),
      box: p.box,
      unitsPerBox: p.unitsPerBox,
      pallet: p.pallet,
      boxesPerPallet: p.boxesPerPallet,
      ean: p.ean,
      gtin: p.gtin,
      origin: p.origin,
      dessin: p.dessin,
      description: p.description,
      unit: "krt"
    });
  });
  const boxes = [...new Set(packing.map((p) => p.box))];
  const pallets = [...new Set(packing.map((p) => p.pallet))];
  return { customers, products, boxes, pallets };
}

function uid() {
  return crypto.randomUUID();
}

function boxLabel(box) {
  if (/europool/i.test(box || "")) return "EuroPool kasse " + box.replace(/europool\s*/i, "");
  return box || "Kasse";
}

function produceLabel(p) {
  const u = Number(p.unitsPerBox) || "";
  const pack = p.packing || "";
  const name = p.product || "";
  return `${u} x ${pack} ${name}, origin ${p.origin || ""}`.replace(/\s+/g, " ").trim();
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
      productName: produceLabel(p),
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
    sales: salesFromPacking(packing),
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
    packing: "Packing source"
  };
  document.getElementById("title").textContent = titles[view] || "Order";
  const el = document.getElementById("content");
  if (view === "orders") el.innerHTML = renderList();
  else if (view === "editor") el.innerHTML = renderEditor();
  else if (view === "catalog") el.innerHTML = renderCatalog();
  else el.innerHTML = renderPacking();
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
      <div class="card"><span>Box types</span><b>${state.boxes.length}</b></div>
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
      <p class="hint">Open an order to write lines as in e-conomic (product no., name, quantity, unit, price, discount, department) using your packing references — not as a spreadsheet.</p>
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
    .map(
      (p) => `<tr>
        <td>${esc(p.code)}</td><td>${esc(p.name)}</td><td>${esc(p.packing)}</td>
        <td>${esc(p.box)}</td><td>${esc(p.unitsPerBox)}</td><td>${esc(p.pallet)}</td>
        <td>${esc(p.ean)}</td><td>${esc(p.origin)}</td>
      </tr>`
    )
    .join("");
  return `
    <div class="card" style="margin-bottom:16px">
      <h3>Customers (${state.customers.length})</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Customer no.</th><th>Customer ID</th><th>Name</th><th>Delivery address</th></tr></thead>
        <tbody>${cRows}</tbody>
      </table></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3>Products & packing SKUs (${state.products.length})</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Product no.</th><th>Name</th><th>Packing</th><th>Box</th><th>Units/box</th><th>Pallet</th><th>EAN</th><th>Origin</th></tr></thead>
        <tbody>${pRows}</tbody>
      </table></div>
    </div>
    <div class="grid-2">
      <div class="card"><h3>Boxes</h3>
        <p class="hint">${state.boxes.map(esc).join(" · ") || "—"}</p></div>
      <div class="card"><h3>Pallets</h3>
        <p class="hint">${state.pallets.map(esc).join(" · ") || "—"}</p></div>
    </div>`;
}

function renderPacking() {
  const rows = state.packing
    .map(
      (p) => `<tr>
        <td>${esc(p.orderNo)}</td><td>${esc(p.customerName)}</td><td>${esc(p.product)}</td>
        <td>${esc(p.boxes)}</td><td>${esc(p.box)}</td><td>${esc(p.packing)}</td>
        <td>${esc(p.pallet)}</td><td>${esc(p.lot)}</td>
      </tr>`
    )
    .join("");
  return `<div class="card"><h3>Source packing orders</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Order</th><th>Customer</th><th>Product</th><th>Boxes</th><th>Box</th><th>Packing</th><th>Pallet</th><th>Lot</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="hint">This is the logistics source. Sales orders map each packing row to an e-conomic line.</p>
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

function pickProduct() {
  openModal(
    `<h3>Add order line from catalogue</h3>
     <input class="search" id="q" placeholder="Search product, box, EAN, packing…" />
     <div class="table-wrap"><table>
       <thead><tr><th>No.</th><th>Name</th><th>Packing</th><th>Box</th><th>EAN</th></tr></thead>
       <tbody id="pickBody"></tbody></table></div>`,
    (bg) => {
      const draw = () => {
        const q = (bg.querySelector("#q").value || "").toLowerCase();
        bg.querySelector("#pickBody").innerHTML = state.products
          .filter((p) => `${p.code} ${p.name} ${p.box} ${p.ean} ${p.packing}`.toLowerCase().includes(q))
          .map(
            (p, i) => `<tr class="clickable" data-i="${i}" data-code="${esc(p.code)}" data-ean="${esc(p.ean)}" data-box="${esc(p.box)}">
              <td>${esc(p.code)}</td><td>${esc(p.name)}</td><td>${esc(p.packing)}</td><td>${esc(p.box)}</td><td>${esc(p.ean)}</td></tr>`
          )
          .join("");
        bg.querySelectorAll("#pickBody tr").forEach((tr) => {
          tr.onclick = () => {
            const p = state.products.find(
              (x) => x.code === tr.dataset.code && x.ean === tr.dataset.ean && x.box === tr.dataset.box
            );
            const sale = state.activeSale;
            const qty = p.boxesPerPallet || 1;
            sale.lines.push({
              id: uid(),
              productNo: p.packingCode || p.box,
              productName: boxLabel(p.box),
              quantity: qty,
              unit: "Kasser",
              unitPrice: 0,
              discount: 0,
              department: ""
            });
            sale.lines.push({
              id: uid(),
              productNo: p.ean || p.code,
              productName: produceLabel(p),
              quantity: qty,
              unit: "Box",
              unitPrice: 0,
              discount: 0,
              department: ""
            });
            if (!sale.isNew) persistSale(sale);
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
  state.sales = salesFromPacking(packing);
  save();
  toast("Imported locally — " + packing.length + " packing rows");
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
