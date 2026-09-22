import React, { useEffect, useMemo, useState, useCallback } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { invoiceApi } from "./api/invoiceApi";
import "./App.css";

const createInvoiceNumber = () => {
  const current =
    Number(localStorage.getItem("invoice_counter") || "1000") + 1;

  localStorage.setItem("invoice_counter", String(current));

  const year = new Date().getFullYear();
  const number = String(current).padStart(4, "0");

  return "INV-" + year + "-" + number;
};

const today = new Date().toISOString().split("T")[0];

const createEmptyItem = () => ({
  id: Date.now() + Math.random(),
  name: "",
  description: "",
  quantity: 1,
  rate: 0,
  gst: 18,
});

const defaultInvoice = () => ({
  id: null,
  invoiceNumber: createInvoiceNumber(),
  invoiceDate: today,
  dueDate: today,

  seller: {
    name: "",
    address: "",
    phone: "",
    email: "",
    gstin: "",
    pan: "",
  },

  customer: {
    name: "",
    company: "",
    address: "",
    phone: "",
    email: "",
    gstin: "",
  },

  placeOfSupply: "Uttar Pradesh",

  items: [createEmptyItem()],

  discount: 0,
  shipping: 0,
  amountPaid: 0,

  notes: "",
  terms:
    "Payment is due by the due date. Goods/services once sold are subject to the agreed terms.",
});

export default function App() {
  const [invoice, setInvoice] = useState(() => {
    const saved = localStorage.getItem("invoice_data");

    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (error) {
        console.error("Could not load saved invoice:", error);
      }
    }

    return defaultInvoice();
  });

  const [taxType, setTaxType] = useState("intra");

  // Backend state
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Saved Invoices Modal state
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [savedInvoices, setSavedInvoices] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(false);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Check backend health periodically
  const checkBackend = useCallback(async () => {
    const connected = await invoiceApi.checkHealth();
    setIsBackendConnected(connected);
  }, []);

  useEffect(() => {
    checkBackend();
    const interval = setInterval(checkBackend, 15000);
    return () => clearInterval(interval);
  }, [checkBackend]);

  useEffect(() => {
    localStorage.setItem("invoice_data", JSON.stringify(invoice));
  }, [invoice]);

  const updateInvoice = (field, value) => {
    setInvoice((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const updateSection = (section, field, value) => {
    setInvoice((previous) => ({
      ...previous,
      [section]: {
        ...previous[section],
        [field]: value,
      },
    }));
  };

  const updateItem = (id, field, value) => {
    setInvoice((previous) => ({
      ...previous,
      items: previous.items.map((item) => {
        if (item.id === id) {
          return {
            ...item,
            [field]: value,
          };
        }

        return item;
      }),
    }));
  };

  const addItem = () => {
    setInvoice((previous) => ({
      ...previous,
      items: [...previous.items, createEmptyItem()],
    }));
  };

  const removeItem = (id) => {
    setInvoice((previous) => {
      if (previous.items.length === 1) {
        return previous;
      }

      return {
        ...previous,
        items: previous.items.filter((item) => item.id !== id),
      };
    });
  };

  const calculations = useMemo(() => {
    let subtotal = 0;

    invoice.items.forEach((item) => {
      const quantity = Number(item.quantity) || 0;
      const rate = Number(item.rate) || 0;

      subtotal += quantity * rate;
    });

    const enteredDiscount = Number(invoice.discount) || 0;

    const discount = Math.min(
      Math.max(enteredDiscount, 0),
      subtotal
    );

    const taxableAmount = subtotal - discount;

    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    invoice.items.forEach((item) => {
      const quantity = Number(item.quantity) || 0;
      const rate = Number(item.rate) || 0;
      const gstRate = Number(item.gst) || 0;

      const itemAmount = quantity * rate;

      let itemDiscount = 0;

      if (subtotal > 0) {
        itemDiscount = (itemAmount / subtotal) * discount;
      }

      const itemTaxableAmount = itemAmount - itemDiscount;

      const itemGST =
        itemTaxableAmount * (gstRate / 100);

      if (taxType === "intra") {
        cgst += itemGST / 2;
        sgst += itemGST / 2;
      } else {
        igst += itemGST;
      }
    });

    const shipping = Math.max(
      Number(invoice.shipping) || 0,
      0
    );

    const total =
      taxableAmount +
      cgst +
      sgst +
      igst +
      shipping;

    const amountPaid = Math.max(
      Number(invoice.amountPaid) || 0,
      0
    );

    const balance = Math.max(total - amountPaid, 0);

    const changeDue = Math.max(amountPaid - total, 0);

    return {
      subtotal,
      discount,
      taxableAmount,
      cgst,
      sgst,
      igst,
      shipping,
      total,
      amountPaid,
      balance,
      changeDue,
    };
  }, [invoice, taxType]);

  const currency = (value) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(Number(value) || 0);
  };

  const formatDate = (dateString) => {
    if (!dateString) {
      return "-";
    }

    const date = new Date(dateString + "T00:00:00");

    if (Number.isNaN(date.getTime())) {
      return dateString;
    }

    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  // Backend Integration Handlers
  const handleSaveToBackend = async () => {
    setIsSaving(true);
    try {
      const payload = {
        ...invoice,
        taxType,
        items: invoice.items.map((item) => ({
          ...item,
          quantity: Number(item.quantity) || 0,
          rate: Number(item.rate) || 0,
          gst: Number(item.gst) || 0,
        })),
      };

      const savedData = await invoiceApi.saveInvoice(payload);

      // Normalize seller and customer if returned from API
      const normalizedInvoice = {
        ...defaultInvoice(),
        ...savedData,
        seller: savedData.seller || invoice.seller,
        customer: savedData.customer || invoice.customer,
        items: savedData.items && savedData.items.length > 0 ? savedData.items : invoice.items,
      };

      setInvoice(normalizedInvoice);
      showToast(`Invoice ${normalizedInvoice.invoiceNumber} saved to backend database!`, "success");
      setIsBackendConnected(true);
    } catch (error) {
      console.error("Save to backend failed:", error);
      showToast("Could not save to Spring Boot backend. Is server running on port 8080?", "error");
      setIsBackendConnected(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenSavedList = async () => {
    setIsListModalOpen(true);
    fetchSavedInvoices();
  };

  const fetchSavedInvoices = async (query = "") => {
    setIsLoadingList(true);
    try {
      const data = await invoiceApi.getAllInvoices(query);
      setSavedInvoices(data);
      setIsBackendConnected(true);
    } catch (error) {
      console.error("Failed to load saved invoices:", error);
      showToast("Unable to load invoices from Spring Boot backend", "error");
    } finally {
      setIsLoadingList(false);
    }
  };

  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    fetchSavedInvoices(query);
  };

  const handleLoadInvoice = (savedInv) => {
    const loaded = {
      ...defaultInvoice(),
      ...savedInv,
      seller: savedInv.seller || defaultInvoice().seller,
      customer: savedInv.customer || defaultInvoice().customer,
      items: savedInv.items && savedInv.items.length > 0 ? savedInv.items : [createEmptyItem()],
    };

    setInvoice(loaded);
    if (savedInv.taxType) {
      setTaxType(savedInv.taxType);
    }
    setIsListModalOpen(false);
    showToast(`Loaded invoice ${savedInv.invoiceNumber}`, "success");
  };

  const handleDeleteSavedInvoice = async (id, invNum, e) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete invoice ${invNum}?`)) {
      return;
    }

    try {
      await invoiceApi.deleteInvoice(id);
      showToast(`Invoice ${invNum} deleted successfully`, "success");
      fetchSavedInvoices(searchQuery);
    } catch (error) {
      console.error("Delete failed:", error);
      showToast(`Failed to delete invoice ${invNum}`, "error");
    }
  };

  const generateNewInvoice = async () => {
    const confirmed = window.confirm(
      "Create a new invoice? Current invoice data will remain saved, but the form will be reset."
    );

    if (!confirmed) {
      return;
    }

    let nextNumber = null;
    if (isBackendConnected) {
      nextNumber = await invoiceApi.getNextInvoiceNumber();
    }

    setInvoice({
      ...defaultInvoice(),
      invoiceNumber: nextNumber || createInvoiceNumber(),
    });

    setTaxType("intra");
    showToast("Started new invoice form", "success");
  };

  const printInvoice = () => {
    window.print();
  };

  const downloadPDF = async () => {
    const element = document.getElementById(
      "invoice-preview"
    );

    if (!element) {
      return;
    }

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const imageData = canvas.toDataURL("image/png");

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pageWidth =
        pdf.internal.pageSize.getWidth();

      const pageHeight =
        pdf.internal.pageSize.getHeight();

      const imageWidth = pageWidth;

      const imageHeight =
        (canvas.height * imageWidth) / canvas.width;

      let heightLeft = imageHeight;
      let position = 0;

      pdf.addImage(
        imageData,
        "PNG",
        0,
        position,
        imageWidth,
        imageHeight
      );

      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imageHeight;

        pdf.addPage();

        pdf.addImage(
          imageData,
          "PNG",
          0,
          position,
          imageWidth,
          imageHeight
        );

        heightLeft -= pageHeight;
      }

      pdf.save(
        invoice.invoiceNumber + ".pdf"
      );
    } catch (error) {
      console.error("PDF generation failed:", error);

      alert(
        "Unable to generate the PDF. Please try again."
      );
    }
  };

  return (
    <div className="app">
      {/* Toast Popup Notification */}
      {toast && (
        <div className="toast-container">
          <div className={`toast ${toast.type}`}>
            {toast.message}
          </div>
        </div>
      )}

      <header className="topbar">
        <div className="topbar-info">
          <div>
            <h1>Invoice Generator</h1>
            <p>Create and manage professional invoices with Java Spring Boot backend</p>
          </div>

          <div
            className={`status-badge ${
              isBackendConnected ? "connected" : "disconnected"
            }`}
            title={
              isBackendConnected
                ? "Spring Boot backend running on port 8080"
                : "Spring Boot backend disconnected"
            }
          >
            <span className="status-dot"></span>
            {isBackendConnected ? "Spring Boot Active" : "Backend Offline"}
          </div>
        </div>

        <div className="top-actions">
          <button
            type="button"
            className="success-btn"
            onClick={handleSaveToBackend}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "💾 Save Invoice"}
          </button>

          <button
            type="button"
            className="secondary-btn"
            onClick={handleOpenSavedList}
          >
            📋 Saved Invoices
          </button>

          <button
            type="button"
            className="secondary-btn"
            onClick={generateNewInvoice}
          >
            + New Invoice
          </button>

          <button
            type="button"
            className="secondary-btn"
            onClick={printInvoice}
          >
            Print
          </button>

          <button
            type="button"
            className="primary-btn"
            onClick={downloadPDF}
          >
            Download PDF
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="editor">
          <div className="card">
            <div className="section-title row-between">
              <h2>Invoice Details</h2>
              {invoice.id && (
                <span style={{ fontSize: "12px", color: "var(--success)", fontWeight: "600" }}>
                  ✓ Database ID: #{invoice.id}
                </span>
              )}
            </div>

            <div className="grid three">
              <Input
                label="Invoice Number"
                value={invoice.invoiceNumber}
                onChange={(value) =>
                  updateInvoice(
                    "invoiceNumber",
                    value
                  )
                }
              />

              <Input
                label="Invoice Date"
                type="date"
                value={invoice.invoiceDate}
                onChange={(value) =>
                  updateInvoice(
                    "invoiceDate",
                    value
                  )
                }
              />

              <Input
                label="Due Date"
                type="date"
                value={invoice.dueDate}
                onChange={(value) =>
                  updateInvoice(
                    "dueDate",
                    value
                  )
                }
              />
            </div>

            <div className="grid two">
              <Input
                label="Place of Supply"
                value={invoice.placeOfSupply}
                onChange={(value) =>
                  updateInvoice(
                    "placeOfSupply",
                    value
                  )
                }
              />

              <Select
                label="Tax Type"
                value={taxType}
                onChange={(value) =>
                  setTaxType(value)
                }
                options={[
                  [
                    "intra",
                    "Intra-State - CGST + SGST",
                  ],
                  [
                    "inter",
                    "Inter-State - IGST",
                  ],
                ]}
              />
            </div>
          </div>

          <div className="card">
            <div className="two-columns">
              <div>
                <div className="section-title">
                  <h2>Seller Details</h2>
                </div>

                <Input
                  label="Business Name"
                  value={invoice.seller?.name}
                  placeholder="Your Business Name"
                  onChange={(value) =>
                    updateSection(
                      "seller",
                      "name",
                      value
                    )
                  }
                />

                <Textarea
                  label="Business Address"
                  value={invoice.seller?.address}
                  placeholder="Complete business address"
                  onChange={(value) =>
                    updateSection(
                      "seller",
                      "address",
                      value
                    )
                  }
                />

                <Input
                  label="Phone"
                  value={invoice.seller?.phone}
                  placeholder="+91 XXXXX XXXXX"
                  onChange={(value) =>
                    updateSection(
                      "seller",
                      "phone",
                      value
                    )
                  }
                />

                <Input
                  label="Email"
                  type="email"
                  value={invoice.seller?.email}
                  placeholder="business@example.com"
                  onChange={(value) =>
                    updateSection(
                      "seller",
                      "email",
                      value
                    )
                  }
                />

                <div className="grid two">
                  <Input
                    label="GSTIN"
                    value={invoice.seller?.gstin}
                    placeholder="GSTIN"
                    onChange={(value) =>
                      updateSection(
                        "seller",
                        "gstin",
                        value.toUpperCase()
                      )
                    }
                  />

                  <Input
                    label="PAN"
                    value={invoice.seller?.pan}
                    placeholder="PAN"
                    onChange={(value) =>
                      updateSection(
                        "seller",
                        "pan",
                        value.toUpperCase()
                      )
                    }
                  />
                </div>
              </div>

              <div>
                <div className="section-title">
                  <h2>Customer Details</h2>
                </div>

                <Input
                  label="Customer Name"
                  value={invoice.customer?.name}
                  placeholder="Customer Name"
                  onChange={(value) =>
                    updateSection(
                      "customer",
                      "name",
                      value
                    )
                  }
                />

                <Input
                  label="Company Name"
                  value={invoice.customer?.company}
                  placeholder="Company Name"
                  onChange={(value) =>
                    updateSection(
                      "customer",
                      "company",
                      value
                    )
                  }
                />

                <Textarea
                  label="Billing Address"
                  value={invoice.customer?.address}
                  placeholder="Customer billing address"
                  onChange={(value) =>
                    updateSection(
                      "customer",
                      "address",
                      value
                    )
                  }
                />

                <Input
                  label="Phone"
                  value={invoice.customer?.phone}
                  placeholder="+91 XXXXX XXXXX"
                  onChange={(value) =>
                    updateSection(
                      "customer",
                      "phone",
                      value
                    )
                  }
                />

                <Input
                  label="Email"
                  type="email"
                  value={invoice.customer?.email}
                  placeholder="customer@example.com"
                  onChange={(value) =>
                    updateSection(
                      "customer",
                      "email",
                      value
                    )
                  }
                />

                <Input
                  label="GSTIN"
                  value={invoice.customer?.gstin}
                  placeholder="GSTIN"
                  onChange={(value) =>
                    updateSection(
                      "customer",
                      "gstin",
                      value.toUpperCase()
                    )
                  }
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-title row-between">
              <h2>Items / Services</h2>

              <button
                type="button"
                className="small-primary"
                onClick={addItem}
              >
                + Add Item
              </button>
            </div>

            <div className="item-list">
              {invoice.items.map(
                (item, index) => (
                  <div
                    className="item-editor"
                    key={item.id || index}
                  >
                    <div className="item-number">
                      {index + 1}
                    </div>

                    <div className="item-fields">
                      <Input
                        label="Item / Service"
                        value={item.name}
                        placeholder="Product or service"
                        onChange={(value) =>
                          updateItem(
                            item.id,
                            "name",
                            value
                          )
                        }
                      />

                      <Input
                        label="Description"
                        value={item.description}
                        placeholder="Short description"
                        onChange={(value) =>
                          updateItem(
                            item.id,
                            "description",
                            value
                          )
                        }
                      />

                      <div className="grid three">
                        <Input
                          label="Quantity"
                          type="number"
                          min="0"
                          value={item.quantity}
                          onChange={(value) =>
                            updateItem(
                              item.id,
                              "quantity",
                              value
                            )
                          }
                        />

                        <Input
                          label="Rate"
                          type="number"
                          min="0"
                          value={item.rate}
                          onChange={(value) =>
                            updateItem(
                              item.id,
                              "rate",
                              value
                            )
                          }
                        />

                        <Select
                          label="GST"
                          value={item.gst}
                          onChange={(value) =>
                            updateItem(
                              item.id,
                              "gst",
                              value
                            )
                          }
                          options={[
                            ["0", "0%"],
                            ["5", "5%"],
                            ["12", "12%"],
                            ["18", "18%"],
                            ["28", "28%"],
                          ]}
                        />
                      </div>
                    </div>

                    <div className="item-total">
                      <span>Total</span>

                      <strong>
                        {currency(
                          (Number(
                            item.quantity
                          ) || 0) *
                            (Number(
                              item.rate
                            ) || 0)
                        )}
                      </strong>

                      {invoice.items.length > 1 && (
                        <button
                          type="button"
                          className="delete-btn"
                          onClick={() =>
                            removeItem(item.id)
                          }
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>

          <div className="card">
            <div className="section-title">
              <h2>Tax & Payment</h2>
            </div>

            <div className="tax-toggle">
              <label>
                <input
                  type="radio"
                  name="taxType"
                  checked={
                    taxType === "intra"
                  }
                  onChange={() =>
                    setTaxType("intra")
                  }
                />

                Intra-State
                <span>
                  (CGST + SGST)
                </span>
              </label>

              <label>
                <input
                  type="radio"
                  name="taxType"
                  checked={
                    taxType === "inter"
                  }
                  onChange={() =>
                    setTaxType("inter")
                  }
                />

                Inter-State
                <span>
                  (IGST)
                </span>
              </label>
            </div>

            <div className="grid three">
              <Input
                label="Discount"
                type="number"
                min="0"
                value={invoice.discount}
                onChange={(value) =>
                  updateInvoice(
                    "discount",
                    value
                  )
                }
              />

              <Input
                label="Shipping / Other Charges"
                type="number"
                min="0"
                value={invoice.shipping}
                onChange={(value) =>
                  updateInvoice(
                    "shipping",
                    value
                  )
                }
              />

              <Input
                label="Amount Paid"
                type="number"
                min="0"
                value={invoice.amountPaid}
                onChange={(value) =>
                  updateInvoice(
                    "amountPaid",
                    value
                  )
                }
              />
            </div>
          </div>

          <div className="card">
            <div className="section-title">
              <h2>Additional Information</h2>
            </div>

            <Textarea
              label="Notes"
              value={invoice.notes}
              placeholder="Thank you for your business."
              onChange={(value) =>
                updateInvoice(
                  "notes",
                  value
                )
              }
            />

            <Textarea
              label="Terms & Conditions"
              value={invoice.terms}
              onChange={(value) =>
                updateInvoice(
                  "terms",
                  value
                )
              }
            />
          </div>
        </section>

        <section className="preview-area">
          <div className="preview-label">
            <span>Live Preview</span>

            <span>
              {invoice.invoiceNumber}
            </span>
          </div>

          <div
            id="invoice-preview"
            className="invoice-paper"
          >
            <div className="invoice-header">
              <div>
                <div className="logo-box">
                  {invoice.seller?.name
                    ? invoice.seller.name
                        .charAt(0)
                        .toUpperCase()
                    : "I"}
                </div>

                <h1>
                  {invoice.seller?.name ||
                    "Your Business Name"}
                </h1>

                <p>
                  {invoice.seller?.address ||
                    "Business address"}
                </p>

                {invoice.seller?.phone && (
                  <p>
                    {invoice.seller.phone}
                  </p>
                )}

                {invoice.seller?.email && (
                  <p>
                    {invoice.seller.email}
                  </p>
                )}
              </div>

              <div className="invoice-meta">
                <h2>INVOICE</h2>

                <div>
                  <span>Invoice #</span>

                  <strong>
                    {invoice.invoiceNumber}
                  </strong>
                </div>

                <div>
                  <span>Date</span>

                  <strong>
                    {formatDate(
                      invoice.invoiceDate
                    )}
                  </strong>
                </div>

                <div>
                  <span>Due Date</span>

                  <strong>
                    {formatDate(
                      invoice.dueDate
                    )}
                  </strong>
                </div>
              </div>
            </div>

            <div className="invoice-parties">
              <div>
                <span className="label">
                  BILL FROM
                </span>

                <h3>
                  {invoice.seller?.name ||
                    "Your Business Name"}
                </h3>

                <p>
                  {invoice.seller?.address ||
                    "Business address"}
                </p>

                {invoice.seller?.phone && (
                  <p>
                    {invoice.seller.phone}
                  </p>
                )}

                {invoice.seller?.email && (
                  <p>
                    {invoice.seller.email}
                  </p>
                )}

                {invoice.seller?.gstin && (
                  <p>
                    <strong>GSTIN:</strong>{" "}
                    {invoice.seller.gstin}
                  </p>
                )}

                {invoice.seller?.pan && (
                  <p>
                    <strong>PAN:</strong>{" "}
                    {invoice.seller.pan}
                  </p>
                )}
              </div>

              <div>
                <span className="label">
                  BILL TO
                </span>

                <h3>
                  {invoice.customer?.name ||
                    "Customer Name"}
                </h3>

                {invoice.customer?.company && (
                  <p>
                    {invoice.customer.company}
                  </p>
                )}

                <p>
                  {invoice.customer?.address ||
                    "Customer address"}
                </p>

                {invoice.customer?.phone && (
                  <p>
                    {invoice.customer.phone}
                  </p>
                )}

                {invoice.customer?.email && (
                  <p>
                    {invoice.customer.email}
                  </p>
                )}

                {invoice.customer?.gstin && (
                  <p>
                    <strong>GSTIN:</strong>{" "}
                    {invoice.customer.gstin}
                  </p>
                )}

                <p>
                  <strong>
                    Place of Supply:
                  </strong>{" "}
                  {invoice.placeOfSupply ||
                    "-"}
                </p>
              </div>
            </div>

            <div className="invoice-table-wrapper">
              <table className="invoice-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>
                      ITEM / DESCRIPTION
                    </th>
                    <th>QTY</th>
                    <th>RATE</th>
                    <th>GST</th>
                    <th>AMOUNT</th>
                  </tr>
                </thead>

                <tbody>
                  {invoice.items.map(
                    (item, index) => {
                      const amount =
                        (Number(
                          item.quantity
                        ) || 0) *
                        (Number(
                          item.rate
                        ) || 0);

                      return (
                        <tr key={item.id || index}>
                          <td>
                            {index + 1}
                          </td>

                          <td>
                            <strong>
                              {item.name ||
                                "Item / Service"}
                            </strong>

                            {item.description && (
                              <small>
                                {
                                  item.description
                                }
                              </small>
                            )}
                          </td>

                          <td>
                            {item.quantity}
                          </td>

                          <td>
                            {currency(
                              item.rate
                            )}
                          </td>

                          <td>
                            {item.gst}%
                          </td>

                          <td>
                            {currency(
                              amount
                            )}
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>

            <div className="invoice-bottom">
              <div className="notes">
                {invoice.notes && (
                  <>
                    <h4>Notes</h4>

                    <p>
                      {invoice.notes}
                    </p>
                  </>
                )}

                {invoice.terms && (
                  <>
                    <h4>
                      Terms & Conditions
                    </h4>

                    <p>
                      {invoice.terms}
                    </p>
                  </>
                )}
              </div>

              <div className="summary">
                <div>
                  <span>
                    Subtotal
                  </span>

                  <strong>
                    {currency(
                      calculations.subtotal
                    )}
                  </strong>
                </div>

                {calculations.discount >
                  0 && (
                  <div>
                    <span>
                      Discount
                    </span>

                    <strong>
                      -{" "}
                      {currency(
                        calculations.discount
                      )}
                    </strong>
                  </div>
                )}

                <div>
                  <span>
                    Taxable Amount
                  </span>

                  <strong>
                    {currency(
                      calculations.taxableAmount
                    )}
                  </strong>
                </div>

                {taxType === "intra" ? (
                  <>
                    <div>
                      <span>
                        CGST
                      </span>

                      <strong>
                        {currency(
                          calculations.cgst
                        )}
                      </strong>
                    </div>

                    <div>
                      <span>
                        SGST
                      </span>

                      <strong>
                        {currency(
                          calculations.sgst
                        )}
                      </strong>
                    </div>
                  </>
                ) : (
                  <div>
                    <span>
                      IGST
                    </span>

                    <strong>
                      {currency(
                        calculations.igst
                      )}
                    </strong>
                  </div>
                )}

                {calculations.shipping >
                  0 && (
                  <div>
                    <span>
                      Shipping
                    </span>

                    <strong>
                      {currency(
                        calculations.shipping
                      )}
                    </strong>
                  </div>
                )}

                <div className="grand-total">
                  <span>
                    Grand Total
                  </span>

                  <strong>
                    {currency(
                      calculations.total
                    )}
                  </strong>
                </div>

                {calculations.amountPaid >
                  0 && (
                  <div>
                    <span>
                      Amount Paid
                    </span>

                    <strong>
                      {currency(
                        calculations.amountPaid
                      )}
                    </strong>
                  </div>
                )}

                {calculations.balance >
                  0 && (
                  <div className="balance">
                    <span>
                      Balance Due
                    </span>

                    <strong>
                      {currency(
                        calculations.balance
                      )}
                    </strong>
                  </div>
                )}

                {calculations.changeDue >
                  0 && (
                  <div>
                    <span>
                      Change Due
                    </span>

                    <strong>
                      {currency(
                        calculations.changeDue
                      )}
                    </strong>
                  </div>
                )}
              </div>
            </div>

            <div className="invoice-footer">
              <p>
                Thank you for your business!
              </p>

              <div className="signature">
                Authorized Signature
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Saved Invoices Modal */}
      {isListModalOpen && (
        <div className="modal-overlay" onClick={() => setIsListModalOpen(false)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Saved Invoices Database</h2>
              <button className="close-btn" onClick={() => setIsListModalOpen(false)}>
                &times;
              </button>
            </div>

            <div className="modal-body">
              <div className="search-box">
                <input
                  type="text"
                  placeholder="🔍 Search invoices by number, customer, or seller..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                />
              </div>

              {isLoadingList ? (
                <div style={{ textAlign: "center", padding: "30px", color: "var(--muted)" }}>
                  Loading saved invoices...
                </div>
              ) : savedInvoices.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
                  {searchQuery ? "No invoices match your search." : "No saved invoices found in database."}
                </div>
              ) : (
                <table className="saved-table">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Date</th>
                      <th>Customer</th>
                      <th>Total</th>
                      <th>Balance</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedInvoices.map((inv) => (
                      <tr key={inv.id || inv.invoiceNumber}>
                        <td>
                          <strong>{inv.invoiceNumber}</strong>
                        </td>
                        <td>{formatDate(inv.invoiceDate)}</td>
                        <td>
                          <strong>{inv.customer?.name || "N/A"}</strong>
                          {inv.customer?.company && (
                            <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                              {inv.customer.company}
                            </div>
                          )}
                        </td>
                        <td>
                          <strong>{currency(inv.total)}</strong>
                        </td>
                        <td>
                          <span style={{ color: inv.balance > 0 ? "var(--danger)" : "var(--success)", fontWeight: "600" }}>
                            {currency(inv.balance)}
                          </span>
                        </td>
                        <td>
                          <div className="action-buttons">
                            <button
                              type="button"
                              className="small-primary"
                              onClick={() => handleLoadInvoice(inv)}
                            >
                              Load
                            </button>
                            <button
                              type="button"
                              className="delete-btn"
                              style={{ marginTop: 0 }}
                              onClick={(e) => handleDeleteSavedInvoice(inv.id, inv.invoiceNumber, e)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder = "",
  min,
}) {
  return (
    <label className="field">
      <span>{label}</span>

      <input
        type={type}
        value={value ?? ""}
        min={min}
        placeholder={placeholder}
        onChange={(event) =>
          onChange(event.target.value)
        }
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  placeholder = "",
}) {
  return (
    <label className="field">
      <span>{label}</span>

      <textarea
        value={value ?? ""}
        placeholder={placeholder}
        rows="3"
        onChange={(event) =>
          onChange(event.target.value)
        }
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}) {
  return (
    <label className="field">
      <span>{label}</span>

      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
      >
        {options.map((option) => (
          <option
            value={option[0]}
            key={option[0]}
          >
            {option[1]}
          </option>
        ))}
      </select>
    </label>
  );
}