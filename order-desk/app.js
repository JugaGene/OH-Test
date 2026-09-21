const STORE = "gp.orderdesk.v1";
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

function lineFromPacking(p, idx) {
  return {
    id: crypto.randomUUID(),
    lineNo: (idx + 1) * 1,
    productNo: String(p.productCode),
    productName: p.product,
    quantity: Number(p.boxes),
    unit: "krt",
    unitPrice: 0,
    discount: 0,
    department: "Packing",
    box: p.box,
    packing: p.packing,
    pallet: p.pallet,
    unitsPerBox: p.unitsPerBox,
    boxesPerPallet: p.boxesPerPallet,
    ean: p.ean,
    gtin: p.gtin,
    lot: p.lot,
    origin: p.origin,
    sscc: p.sscc,
    bbd: fmtDate(p.bbd),
    netKg: p.netKg,
    description: p.description,
    packingOrder: p.orderNo
  };
}

function salesFromPacking(packing) {
  const groups = new Map();
  packing.forEach((p) => {
    const key = p.customerId + "|" + p.deliveryDate;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  const sales = [];
  groups.forEach((rows) => {
    const first = rows[0];
    sales.push({
      id: crypto.randomUUID(),
      number: "S-" + first.orderNo,
      customerId: first.customerId,
      customerNo: first.customerNo,
      customerName: first.customerName,
      delivery: first.delivery,
      paymentTerms: "Netto 14 dage",
      date: fmtDate(first.orderDate),
      deliveryDate: fmtDate(first.deliveryDate),
      yourRef: first.customerRef,
      ourRef: first.internalRef && first.internalRef !== "0" ? first.internalRef : first.orderNo,
      otherRef: rows.map((r) => r.orderNo).join(", "),
      heading: "Sales order",
      layout: "Order",
      currency: "DKK",
      lines: rows.map(lineFromPacking)
    });
  });
  return sales;
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
    id: crypto.randomUUID(),
    number: "S-NEW",
    customerId: "",
    customerNo: "",
    customerName: "",
    delivery: "",
    paymentTerms: "Netto 14 dage",
    date: new Date().toISOString().slice(0, 10),
    deliveryDate: "",
    yourRef: "",
    ourRef: "",
    otherRef: "",
    heading: "Sales order",
    layout: "Order",
    currency: "DKK",
    lines: []
  };
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
    editor: "Order",
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
  const cust = s.customerName
    ? `<button class="cust-btn filled" id="pickCust"><strong>${esc(s.customerName)}</strong><small>No. ${esc(s.customerNo)} · ID ${esc(s.customerId)}</small></button>`
    : `<button class="cust-btn" id="pickCust">Add customer</button>`;
  const lineRows = s.lines
    .map(
      (l, i) => `<tr data-line="${l.id}">
        <td>${i + 1}</td>
        <td><input data-f="productNo" value="${esc(l.productNo)}" /></td>
        <td><input data-f="productName" value="${esc(l.productName)}" /></td>
        <td class="num"><input data-f="quantity" type="number" step="1" value="${esc(l.quantity)}" /></td>
        <td><input data-f="unit" value="${esc(l.unit)}" /></td>
        <td class="num"><input data-f="unitPrice" type="number" step="0.01" value="${esc(l.unitPrice)}" /></td>
        <td class="num"><input data-f="discount" type="number" step="0.01" value="${esc(l.discount)}" /></td>
        <td class="num">${money(lineTotal(l))}</td>
        <td><input data-f="department" value="${esc(l.department)}" /></td>
        <td><button class="icon-del" data-del="${l.id}" title="Remove">✕</button></td>
      </tr>
      <tr>
        <td></td>
        <td colspan="9" style="color:#5c675f;font-size:12px;padding-top:0">
          Box ${esc(l.box)} · ${esc(l.packing)} · ${esc(l.unitsPerBox)} units/box · Pallet ${esc(l.pallet)} (${esc(l.boxesPerPallet)}/plt)
          · EAN ${esc(l.ean)} · Lot ${esc(l.lot)} · Origin ${esc(l.origin)} · SSCC ${esc(l.sscc)} · BBD ${esc(l.bbd)} · ${esc(l.netKg)} kg
          · Packing order ${esc(l.packingOrder)}
        </td>
      </tr>`
    )
    .join("");
  const chips = [
    s.delivery && `Delivery: ${s.delivery}`,
    `${s.lines.reduce((n, l) => n + Number(l.quantity || 0), 0)} cartons`,
    `${s.lines.reduce((n, l) => n + Number(l.netKg || 0), 0)} kg net`
  ]
    .filter(Boolean)
    .map((c) => `<span class="chip">${esc(c)}</span>`)
    .join("");
  return `
    <div class="eco">
      <div class="eco-head">
        <div class="eco-col">
          ${cust}
          <div class="meta-row">
            <div><label>Payment terms</label><input id="fTerms" value="${esc(s.paymentTerms)}" /></div>
            <div><label>Date</label><input id="fDate" type="date" value="${esc(s.date)}" /></div>
          </div>
          <div class="meta-row">
            <div style="flex:1"><label>Delivery</label>
              <input id="fDeliv" style="width:100%" value="${esc(s.delivery)}" /></div>
          </div>
        </div>
        <div class="eco-col notes">
          <strong>Notes and references</strong>
          <div class="row"><label>Heading</label><input id="fHead" value="${esc(s.heading)}" /></div>
          <div class="row"><label>Your ref.</label><input id="fYref" value="${esc(s.yourRef)}" /></div>
          <div class="row"><label>Our ref.</label><input id="fOref" value="${esc(s.ourRef)}" /></div>
          <div class="row"><label>Other ref.</label><input id="fXref" value="${esc(s.otherRef)}" /></div>
          <div class="row"><label>Layout</label><input id="fLay" value="${esc(s.layout)}" /></div>
        </div>
        <div class="eco-col totals">
          <div class="preview" id="btnPrint">Show order</div>
          <div class="row"><span>Subtotal</span><span>${money(t.sub)}</span></div>
          <div class="row"><span>VAT (25%)</span><span>${money(t.vat)}</span></div>
          <div class="row grand"><span>Total <span class="dkk">${esc(s.currency)}</span></span><span>${money(t.total)}</span></div>
        </div>
      </div>
      <div class="eco-actions">
        <button class="btn primary" id="btnNewLine">New order line</button>
        <button class="btn ghost" id="btnSave">Save locally</button>
        <button class="btn" id="btnPdf">Print / PDF</button>
        <span class="right">${s.lines.length} item(s) in total</span>
      </div>
      <div class="table-wrap lines">
        <table>
          <thead>
            <tr>
              <th>Line no.</th>
              <th>Product no.</th>
              <th>Product name</th>
              <th>Quantity</th>
              <th>Unit</th>
              <th>Unit price</th>
              <th>Discount (%)</th>
              <th>Total</th>
              <th>Afdeling</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${lineRows || `<tr><td colspan="10" style="color:#888">No lines — choose New order line and pick from your product catalogue.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="pack-strip">${chips}</div>
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
    sale.paymentTerms = document.getElementById("fTerms").value;
    sale.date = document.getElementById("fDate").value;
    sale.delivery = document.getElementById("fDeliv").value;
    sale.heading = document.getElementById("fHead").value;
    sale.yourRef = document.getElementById("fYref").value;
    sale.ourRef = document.getElementById("fOref").value;
    sale.otherRef = document.getElementById("fXref").value;
    sale.layout = document.getElementById("fLay").value;
  };
  ["fTerms", "fDate", "fDeliv", "fHead", "fYref", "fOref", "fXref", "fLay"].forEach((id) => {
    const n = document.getElementById(id);
    if (n) n.addEventListener("change", persistHead);
  });
  document.querySelectorAll("tr[data-line] input").forEach((inp) => {
    inp.addEventListener("change", () => {
      const id = inp.closest("tr").dataset.line;
      const line = sale.lines.find((l) => l.id === id);
      const f = inp.dataset.f;
      line[f] = inp.type === "number" ? Number(inp.value) : inp.value;
      save();
      render();
    });
  });
  document.querySelectorAll("[data-del]").forEach((b) => {
    b.addEventListener("click", () => {
      sale.lines = sale.lines.filter((l) => l.id !== b.dataset.del);
      save();
      render();
    });
  });
  document.getElementById("pickCust")?.addEventListener("click", pickCustomer);
  document.getElementById("btnNewLine")?.addEventListener("click", pickProduct);
  document.getElementById("btnSave")?.addEventListener("click", () => {
    persistHead();
    const i = state.sales.findIndex((x) => x.id === sale.id);
    if (i >= 0) state.sales[i] = sale;
    else state.sales.unshift(sale);
    save();
    toast("Saved on this PC only");
  });
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
              delivery: c.delivery
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
            sale.lines.push({
              id: crypto.randomUUID(),
              lineNo: sale.lines.length + 1,
              productNo: p.code,
              productName: p.name,
              quantity: p.boxesPerPallet || 1,
              unit: p.unit,
              unitPrice: 0,
              discount: 0,
              department: "Packing",
              box: p.box,
              packing: p.packing,
              pallet: p.pallet,
              unitsPerBox: p.unitsPerBox,
              boxesPerPallet: p.boxesPerPallet,
              ean: p.ean,
              gtin: p.gtin,
              lot: "",
              origin: p.origin,
              sscc: "",
              bbd: "",
              netKg: "",
              description: p.description,
              packingOrder: ""
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
