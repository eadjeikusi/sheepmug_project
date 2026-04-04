## Table Structure Specifications

If you are sending this to a developer, they need to know the **Data Schema** (how the data is organized) and the **Layout Hierarchy** (how the UI is built).

---

### **1. Data Schema (The Backend Structure)**

The developer should treat each row as an object. Here is the recommended structure for the database or API response:

| Field Name | Data Type | Description |
| --- | --- | --- |
| **id** | UUID / Int | Unique identifier for the member. |
| **avatar_url** | String (URL) | Path to the profile image. |
| **full_name** | String | The user's displayed name. |
| **role_label** | String | The text for the badge (e.g., "Lead"). |
| **position** | String (Nullable) | Job title; handles "null" by showing "No position". |
| **email** | String (Email) | The user's contact address. |
| **joined_at** | DateTime | Stored as a timestamp, rendered as a relative date. |
| **status** | Enum | Values: `active`, `inactive`, `pending`. |

---

### **2. UI Component Hierarchy (The Frontend Structure)**

This is how the developer will "nest" the elements to match your image:

* **Table Header (`<thead>`):**
* Labels: Member, Role, Position, Email, Joined Date, Status, Actions.
* Style: Uppercase, semi-bold, muted color.


* **Table Body (`<tbody>`):**
* **Cell 1 (Flex Container):** * `Image` (Circle) + `Vertical Stack` (`Name` + `Badge`).
* **Cell 2 (Text):** Simple string.
* **Cell 3 (Interactive):** Text with a leading/trailing `Icon` button for editing.
* **Cell 4 (Link/Text):** Standard text string.
* **Cell 5 (Computed Text):** A function that converts a date to "X days ago".
* **Cell 6 (Pill/Tag):** A container with `Border-Radius: 999px` and an `Icon`.
* **Cell 7 (Action Button):** A button trigger for a dropdown menu.



---

### **3. Layout Rules**

* **Border Collapse:** The table uses a "Separate" border-spacing or a wrapper `div` with a border to create the rounded-corner box effect.
* **Cell Padding:** Approximately `16px` (1rem) of vertical padding per row.
* **Column Widths:** The "Member" column should be flexible (expandable), while "Actions" should be fixed (narrow).

---

**Would you like me to provide a sample JSON object that the developer can use to test this structure?**