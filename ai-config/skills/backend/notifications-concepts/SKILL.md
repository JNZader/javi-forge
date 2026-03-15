---
name: notifications-concepts
description: >
  Notification system concepts. Email, SMS, Push, in-app notifications, delivery tracking.
  Trigger: notifications, email, SMS, push, FCM, APNS, in-app
tools:
  - Read
  - Write
  - Edit
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [notifications, email, sms, push]
  scope: ["**/notifications/**"]
---

# Notification System Concepts

## Notification Channels

### Email
```
Providers:
- SendGrid, Mailgun, AWS SES, Postmark

Use cases:
- Transactional (receipts, password reset)
- Marketing (newsletters, promotions)
- System alerts (security, billing)

Considerations:
- Deliverability (SPF, DKIM, DMARC)
- Bounce handling
- Unsubscribe management
- Template rendering
```

### SMS
```
Providers:
- Twilio, Vonage, AWS SNS, MessageBird

Use cases:
- 2FA/OTP codes
- Order updates
- Appointment reminders
- Emergency alerts

Considerations:
- Character limits (160 GSM-7, 70 Unicode)
- Delivery receipts
- Opt-in/opt-out (TCPA compliance)
- Cost per message
```

### Push Notifications
```
Platforms:
- FCM (Firebase Cloud Messaging) - Android/Web
- APNS (Apple Push Notification Service) - iOS
- Web Push (PWA)

Use cases:
- Real-time updates
- Re-engagement
- Breaking news
- Chat messages

Considerations:
- Device token management
- Silent vs visible notifications
- Badge counts
- Action buttons
```

### In-App Notifications
```
Types:
- Toast/snackbar (transient)
- Banner (persistent until dismissed)
- Badge (counter on icon)
- Feed (notification center)

Use cases:
- Feature announcements
- Activity updates
- Social interactions
- System messages
```

## Notification Architecture

```
┌──────────────┐
│ Application  │
└──────┬───────┘
       ↓
┌──────────────────────────────────┐
│     Notification Service         │
│  ┌────────────────────────────┐  │
│  │   Channel Router           │  │
│  └────────────────────────────┘  │
│       ↓         ↓         ↓      │
│  ┌────────┐ ┌────────┐ ┌────────┐│
│  │ Email  │ │  SMS   │ │  Push  ││
│  │Provider│ │Provider│ │Provider││
│  └────────┘ └────────┘ └────────┘│
└──────────────────────────────────┘
       ↓         ↓         ↓
   Mailgun    Twilio      FCM
```

## Notification Data Model

```
Notification:
  id: UUID
  userId: string
  type: enum (transactional, marketing, system)
  channel: enum (email, sms, push, in_app)
  template: string
  data: JSON (template variables)
  status: enum (pending, sent, delivered, failed, read)
  scheduledAt: timestamp (null = immediate)
  sentAt: timestamp
  deliveredAt: timestamp
  readAt: timestamp
  metadata: JSON

Template:
  id: string
  channel: enum
  subject: string (email only)
  body: string (with placeholders)
  locale: string
```

## User Preferences

```json
{
  "userId": "user-123",
  "channels": {
    "email": {
      "enabled": true,
      "address": "user@example.com",
      "verified": true
    },
    "sms": {
      "enabled": true,
      "number": "+1234567890",
      "verified": true
    },
    "push": {
      "enabled": true,
      "tokens": [
        {"platform": "ios", "token": "xxx"},
        {"platform": "android", "token": "yyy"}
      ]
    }
  },
  "preferences": {
    "marketing": false,
    "orderUpdates": true,
    "securityAlerts": true,
    "quietHours": {
      "enabled": true,
      "start": "22:00",
      "end": "08:00",
      "timezone": "America/New_York"
    }
  }
}
```

## Delivery Strategies

### Priority-based Routing
```
Critical (security alerts):
  1. Push (immediate)
  2. SMS (fallback)
  3. Email (always)

Transactional (order updates):
  1. Push if available
  2. Email always

Marketing:
  1. Email only
  2. Respect preferences
```

### Batching
```
Individual: Send immediately
  - Password reset
  - OTP codes

Batched: Aggregate and send
  - Social notifications ("5 people liked your post")
  - Activity digests

Scheduled: Send at optimal time
  - Marketing campaigns
  - Weekly summaries
```

## Tracking & Analytics

```
Metrics to track:
- Send rate (attempted)
- Delivery rate (confirmed)
- Open rate (email/push)
- Click rate (links)
- Bounce rate (email)
- Unsubscribe rate
- Opt-out rate

Events:
- notification.created
- notification.sent
- notification.delivered
- notification.opened
- notification.clicked
- notification.bounced
- notification.failed
```

## Best Practices

```
Content:
✅ Clear, actionable subject lines
✅ Personalization (name, context)
✅ Mobile-friendly formatting
✅ Unsubscribe link (email)
❌ Misleading subjects
❌ Excessive frequency
❌ Sending without consent

Technical:
✅ Idempotent sending
✅ Retry with backoff
✅ Rate limiting per user
✅ Template versioning
❌ Hardcoded content
❌ Synchronous sending
❌ Ignoring bounces
```

## Related Skills

- `notifications-spring`: Spring Boot notification implementation
- `apigen-architecture`: Overall system architecture


