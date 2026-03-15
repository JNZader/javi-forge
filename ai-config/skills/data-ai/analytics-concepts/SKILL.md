---
name: analytics-concepts
description: >
  Product analytics concepts: event tracking, funnels, cohorts, user journeys.
  Trigger: analytics, event tracking, funnel, cohort, user journey, metrics
tools:
  - Read
  - Write
  - Edit
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [analytics, tracking, metrics, product]
  scope: ["**/analytics/**"]
---

# Analytics Concepts

## Core Concepts

### Event Tracking
```
Events are discrete user actions:
- page_view, button_click, form_submit
- purchase, signup, login
- custom business events

Structure:
{
  "event": "purchase_completed",
  "userId": "user-123",
  "timestamp": "2024-01-15T10:30:00Z",
  "properties": {
    "amount": 99.99,
    "currency": "USD",
    "items": ["product-1", "product-2"]
  }
}
```

### User Identification
```
Identify: Link anonymous → authenticated user
Alias: Merge multiple identities

Flow:
1. Anonymous visitor (device_id: abc123)
2. User signs up (user_id: user-456)
3. Identify call links abc123 → user-456
4. Historical events attributed to user-456
```

### Funnels
```
Conversion funnels track multi-step processes:

Signup Funnel:
  Landing Page (1000 visitors)
       ↓ 60% conversion
  Signup Form (600 started)
       ↓ 75% conversion
  Email Verification (450 sent)
       ↓ 80% conversion
  Profile Complete (360 completed)

Overall: 36% conversion rate
```

### Cohorts
```
Group users by shared characteristics:

Time-based:
- "January 2024 signups"
- "Users active in last 7 days"

Behavior-based:
- "Users who completed onboarding"
- "Power users (>10 sessions/week)"

Attribute-based:
- "Enterprise plan users"
- "Mobile-only users"
```

### User Journeys
```
Session-based path analysis:

Typical Journey:
Homepage → Product List → Product Detail → Cart → Checkout → Confirmation

Touchpoints to track:
- Entry point (referrer, campaign)
- Pages visited (sequence, duration)
- Actions taken (clicks, scrolls)
- Exit point (conversion or drop-off)
```

## Analytics Providers

### Provider Comparison
| Provider | Best For | Pricing |
|----------|----------|---------|
| Google Analytics | Free tier, SEO | Free / 360 |
| Mixpanel | Product analytics | Event-based |
| Amplitude | Behavioral analytics | MTU-based |
| Segment | CDP + routing | MTU-based |

### Provider Abstraction
```
// Provider-agnostic interface
interface AnalyticsProvider {
    trackEvent(event, properties)
    identifyUser(userId, traits)
    aliasUser(previousId, newId)
    setUserProperties(userId, properties)
    flush()  // Force send buffered events
}

// Multi-provider routing
analytics.track("purchase", {amount: 99})
  → Sends to GA4, Mixpanel, Amplitude simultaneously
```

## Metrics Framework

### AARRR Pirate Metrics
```
Acquisition: How do users find us?
  - Traffic sources, campaign performance

Activation: Do users have a good first experience?
  - Signup rate, onboarding completion

Retention: Do users come back?
  - DAU/MAU, retention curves

Referral: Do users tell others?
  - NPS, viral coefficient

Revenue: Do we make money?
  - ARPU, LTV, conversion rate
```

### Event Naming Conventions
```
Format: object_action (snake_case)

Good:
- user_signed_up
- product_viewed
- order_completed
- subscription_cancelled

Bad:
- SignUp (inconsistent)
- click (too generic)
- userDidSomething (unclear)
```

## Implementation Patterns

### Event Schema
```
Standard properties (always include):
- timestamp: ISO 8601
- userId or anonymousId
- sessionId
- platform (web, ios, android)
- version (app version)

Event-specific properties:
- Relevant to the action
- No PII in event names
- Use IDs, not names for entities
```

### Privacy Considerations
```
GDPR/CCPA compliance:
1. User consent before tracking
2. Right to deletion (purge user data)
3. Data minimization (track only needed)
4. Anonymization options
5. Data retention policies
```

## Related Skills

- `analytics-spring`: Spring Boot analytics implementation
- `apigen-architecture`: Overall system architecture


