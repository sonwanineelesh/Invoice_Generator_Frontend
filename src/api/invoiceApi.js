const API_BASE_URL = "http://localhost:8080/api/invoices";

export const invoiceApi = {

  // Fetch all saved invoices (optional search query)
  async getAllInvoices(query = "") {
    try {
      const url = query ? `${API_BASE_URL}?query=${encodeURIComponent(query)}` : API_BASE_URL;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch invoices: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Error fetching invoices from backend:", error);
      throw error;
    }
  },

  // Save or update an invoice
  async saveInvoice(invoiceData) {
    try {
      const response = await fetch(API_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(invoiceData),
      });

      if (!response.ok) {
        throw new Error(`Failed to save invoice: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error saving invoice to backend:", error);
      throw error;
    }
  },

  // Get invoice by ID
  async getInvoiceById(id) {
    try {
      const response = await fetch(`${API_BASE_URL}/${id}`);
      if (!response.ok) {
        throw new Error(`Invoice not found: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Error fetching invoice by id:", error);
      throw error;
    }
  },

  // Delete invoice
  async deleteInvoice(id) {
    try {
      const response = await fetch(`${API_BASE_URL}/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Failed to delete invoice: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Error deleting invoice:", error);
      throw error;
    }
  },

  // Get next sequential invoice number from server
  async getNextInvoiceNumber() {
    try {
      const response = await fetch(`${API_BASE_URL}/next-number`);
      if (!response.ok) {
        throw new Error(`Failed to get next invoice number`);
      }
      const data = await response.json();
      return data.invoiceNumber;
    } catch (error) {
      console.error("Error fetching next invoice number:", error);
      return null;
    }
  },

  // Ping backend to check health
  async checkHealth() {
    try {
      const response = await fetch(API_BASE_URL);
      return response.ok;
    } catch {
      return false;
    }
  }
};
