# Website Deployment & Operations Guide

This guide documents the production hosting setup for the **SpecOCD** website (`website/`) deployed on **Google Firebase Hosting** with custom domain routing for **specocd.in**.

---

## 💰 Hosting Overview & Cost Guarantee

- **Platform**: Google Firebase Hosting (Spark Plan)
- **GCP Project**: `exclusive-509512` (Project Name: *Exclusive*)
- **Monthly Cost**: **$0.00 / month** (Always Free Tier)
- **Included Quotas**:
  - Storage: 10 GB (Site footprint: ~170 KB)
  - Bandwidth: 360 MB / day
  - SSL Certificate: Included (Auto-provisioned & Auto-renewed)
  - Global CDN: Worldwide edge caching

---

## 🌐 Production URLs

| Type | URL |
| :--- | :--- |
| **Custom Apex Domain** | [https://specocd.in](https://specocd.in) |
| **Custom Subdomain (Redirect)** | [https://www.specocd.in](https://www.specocd.in) |
| **Primary Firebase CDN** | [https://exclusive-509512.web.app](https://exclusive-509512.web.app) |
| **Secondary Firebase CDN** | [https://exclusive-509512.firebaseapp.com](https://exclusive-509512.firebaseapp.com) |
| **Firebase Console** | [Firebase Project Console](https://console.firebase.google.com/project/exclusive-509512/overview) |

---

## 📋 GoDaddy DNS Configuration Reference

The domain **`specocd.in`** is managed via GoDaddy DNS with the following active records:

| Record Type | Host / Name | Value / Target | Purpose |
| :--- | :--- | :--- | :--- |
| **A** | `@` | `199.36.158.100` | Points apex domain to Firebase Global CDN |
| **TXT** | `@` | `hosting-site=exclusive-509512` | Google domain ownership verification |
| **CNAME** | `www` | `exclusive-509512.web.app.` | Routes www subdomain |
| **TXT** | `_acme-challenge` | `xwxTFAsFSWPZs2t2wCEz3AgfKErJSP7JzLC-blvpeco` | Google ACME SSL certificate issuance |

---

## 🚀 How to Deploy Updates

Whenever you make updates to the static files inside the `website/` folder (HTML, CSS, assets, etc.):

### 1. From the Project Root
```bash
# Navigate to spec-ocd project directory
cd /Users/adityay/Sites/Docker/Demo/spec-ocd

# Deploy hosting assets to Firebase
npx firebase-tools deploy --only hosting
```

### 2. Deployment Configuration (`firebase.json`)
The site deployment is controlled by `firebase.json`:
```json
{
  "hosting": {
    "public": "website",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "headers": [
      {
        "source": "**/*.@(jpg|jpeg|gif|png|svg|webp|js|css)",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "max-age=31536000"
          }
        ]
      }
    ]
  }
}
```

---

## 🔒 Rollbacks & Version History

Firebase Hosting stores deployment history. In the event of an issue:
1. Open the [Firebase Hosting Console Releases](https://console.firebase.google.com/project/exclusive-509512/hosting/sites/exclusive-509512).
2. Click the three dots `...` next to any previous version.
3. Click **Roll back** for an instant revert.
