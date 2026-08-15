# BP Cost — FSAE / BAJA Cost Entry Web

เว็บกรอก Cost สำหรับทีม FSAE/BAJA ที่คำนวณราคาอัตโนมัติ (วัสดุ + กระบวนการผลิต + ประกอบ)
และเด้งข้อมูลลง **Google Sheet เดิมของทีม** ผ่าน NocoDB。รองรับหลายฝ่าย หลายคัน
(FSAE + BAJA) และคัดลอก BOM ข้ามคันได้。

> **หลักการ:** มูลค่าทุกอย่างใน Sheet ต้องเป็น **USD เสมอ**。ในเว็บสามารถสลับแสดง
> **USD / THB** ได้ตามสะดวก (ใช้ rate จาก `VITE_USD_TO_THB`)。

---

## 1. เริ่มใช้ทันที (Local mode — ไม่ต้องมี backend)

```bash
npm install
npm run dev          # เปิด http://localhost:5173
```

ข้อมูลเก็บใน browser localStorage (mode `local`) — กรอก คำนวณ แสดงผล ได้เลย
ไม่ต้องตั้งอะไร。เหมาะสำหรับทดลอง / ใช้เครื่องตัวเอง。

---

## 2. เชื่อมกับ Google Sheet เดิม (Bridge mode — NocoDB)

ทำตามนี้เพื่อให้เว็บเขียนลง Sheet ที่ทีมใช้อยู่จริง:

### 2.1 สร้าง NocoDB (ฟรี)
- สมัคร / deploy NocoDB บน **Railway** หรือ **Render** (ฟรี)
- สร้าง Project แล้ว **Add Project → Google Sheets** → OAuth เลือก Spreadsheet ของทีม
- NocoDB จะ sync 2 ทางกับ Sheet (Sheet ยังคงเป็นต้นทาง)

### 2.2 สร้างตารางใน NocoDB
สร้าง table ชื่อ `parts` (และ `cars`, `departments`, `materials`, `processes` ถ้าต้องการ)
คอลัมน์ต้องตรงกับแมปด้านล่าง (ดู `src/types.ts` → `SHEET_COLUMNS`):

| ชื่อคอลัมน์ NocoDB | หมายถึง |
|---|---|
| `Part ID` | รหัสชิ้นส่วน (PK) |
| `Parent ID` | ชิ้นส่วนแม่ (ลำดับชั้น BOM) |
| `Car` | รหัสคัน (BP18 / BAJA) |
| `Department` | รหัสฝ่าย |
| `Part Name` | ชื่อ |
| `Qty / Car` | จำนวนต่อคัน |
| `Material` | รหัสวัสดุ |
| `Mass / Unit` | มวลตามหน่วยวัสดุ |
| `Process` | รหัสกระบวนการ |
| `Process Qty` | จำนวนรอบผลิต |
| `Assembly (min)` | เวลาประกอบ (นาที) |
| `Status` | draft / approved |

> ถ้า Sheet เดิมของคุณมีคอลัมน์อื่น/ฟอร์มูล่า → แนะนำแยกเป็น **data sheet** (เว็บเขียน)
> และ **report sheet** (ดึงมาจัดฟอร์แมต) เพื่อไม่ให้พัง template เดิม

### 2.3 ตั้ง Environment
คัดลอก `.env.example` เป็น `.env` แล้วกรอก:

```
VITE_DATA_MODE=nocodb
VITE_NOCODB_URL=https://your-nocodb.railway.app
VITE_NOCODB_TOKEN=<project xc-token>
VITE_USD_TO_THB=36.5
```

ดู token ได้ที่ NocoDB → Project → Swagger → copy `xc-token`。
หลังตั้งค่า รัน `npm run dev` แล้วสถานะบนแถบบนจะขึ้น `Sheets (live)` แทน `Local`。

---

## 3. Build & Deploy (Vercel — ไม่มีเซิร์ฟเวอร์ตัวเอง)

```bash
npm run build      # สร้าง dist/
npm run preview    # เช็กของbuild locally
```

Deploy ไป Vercel (แนะนำ เพราะคุณไม่เอาเซิร์ฟเครื่องตัวเอง):
1. Push โปรเจกต์นี้ขึ้น GitHub
2. Vercel → New Project → import repo → Framework = **Vite**
3. ใส่ Environment Variables เดียวกับ `.env` (โดยเฉพาพ `VITE_DATA_MODE`, `VITE_NOCODB_URL`, `VITE_NOCODB_TOKEN`)
4. Deploy → ได้ URL กระจายทั่วทีม

> ทุกคนเปิดเว็บกรอก → ข้อมูลเด้งลง Sheet เดิม → หัวฝ่ายดูตัวเลขบน Sheet ต่อได้เลย

---

## 4. ฟีเจอร์

- **Dashboard** — KPI รวม cost ต่อคัน/ต่อฝ่าย สัดส่วน material vs labor + **ปุ่ม Export FSAE xlsx** (เลือกคัน)
- **Parts / BOM** — ฟอร์มกรอก assembly + **จัดการ Child Parts (Details)** ในตัว
  - คำนวณสด (material/mfg/assembly/extended) รวมค่าลูกในลำดับชั้น
  - ใส่ `Parent` ได้ → ลำดับชั้น BOM
  - **Copy car BOM** → ก๊อป BOM จากคันนึงไปอีกคัน (FSAE → BAJA ปรับได้)
  - Filter ตามคัน / ฝ่าย
- **Library** — ฐานข้อมูลนำกลับใช้ใหม่: ฝ่าย, คัน, วัสดุ, กระบวนการ (เพิ่มได้ anytime)
- **Export FSAE xlsx** — สร้างไฟล์ตาม template `Body & Frame Cost BP16b.xlsx` เป๊ะ
  (1 sheet ต่อ assembly, หัว University/System/Assembly/Part/P/N + ตาราง Details)
  เหมาะสำหรับส่งรายงาน FSAE จริง
- **สกุลเงิน** — สลับ USD/THB ในเว็บ (Sheet ยังคง USD เสมอ)
- **ไม่มีล็อกอิน**

> Template ถูกคัดล้อมไว้ที่ `public/template/Body & Frame Cost BP16b.xlsx`
> ถ้าคุณอัปเดต template ใหม่ ให้แทนที่ไฟล์นี้ (generator โคลน style/merge จากนั้น)

---

## 5. เครื่องคำนวณราคา (`src/lib/cost.ts`)

```
materialCost = mass × material.rate
mfgCost      = (setupTime/60 × machineRate) + (runRate×processQty/60 × (machineRate+laborRate))
assemblyCost = (assemblyTime/60) × laborRate
totalCost    = material + mfg + assembly
extendedCost = total × qtyPerCar        // roll-up รวมลูกในลำดับชั้น
```

ทุกค่าใน Sheet เก็บเป็น USD。แปลง THB เฉพาะตอนแสดงผล。

---

## 6. คำสั่งอื่น

```bash
npm run lint      # eslint
npm test          # unit test เครื่องคำนวณ (tsx --test)
npm run build     # type-check + build
```

## 7. โครงสร้างไฟล์

```
src/
  types.ts              # โมเดลข้อมูล + แมปคอลัมน์ Sheet
  lib/cost.ts           # เครื่องคำนวณ + สกุลเงิน (USD-only in sheet)
  lib/nocodb.ts         # adapter เปิด/ปิด bridge ไป Sheet
  data/seed.ts          # ข้อมูลตั้งต้น (BP18, BAJA, 4 ฝ่าย)
  data/useStore.ts      # localStorage store + React Query
  components/           # TopBar, Sidebar, Dashboard, PartsView, PartEditor, Library
```
