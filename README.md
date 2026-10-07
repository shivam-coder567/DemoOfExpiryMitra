# ExpiryMitra Practice Build

This is a **practice/learning build** for the ExpiryMitra architecture.

Use it to understand the complete flow before the Oct 10 fresh hackathon implementation.

## Practice flow

Camera → Barcode → Expiry Image → POST /api/scan → Product Lookup → Mock OCR → Mock AI → Validation → Save → Inventory

## Important

This is NOT the hackathon submission repository. The real hackathon implementation should be rebuilt in the fresh repo on Oct 10 according to the team's coding-window rule.

## Run

Requirements:
- Node.js 18+
- A browser that allows camera access on localhost

```bash
npm install
npm run dev
```

Open:

http://localhost:3000

## Practice test

1. Open Scan.
2. Allow camera permission.
3. Point the camera at a real product barcode.
4. When detected, rotate the package so the expiry area is visible.
5. Capture the expiry image.
6. Send the scan.
7. The practice backend uses deterministic mock OCR/AI.
8. Review the result.
9. Confirm/save.
10. Open Inventory.

## What this practice build teaches

### Shivam
- Camera
- Barcode scanning
- Expiry image capture
- Base64 image upload
- API integration

### Vishwas
- Express server
- Product lookup
- OCR service boundary
- AI interpretation service boundary
- Validation
- Inventory persistence
- API testing

### Yashashvi
- Scan UI states
- Result/confirmation
- Inventory UI
- API consumption

### Suryansh
- Real-product testing flow
- Success/failure test cases
