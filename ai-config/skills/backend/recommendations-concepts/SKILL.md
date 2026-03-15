---
name: recommendations-concepts
description: >
  Recommendation engine concepts. Collaborative filtering, content-based, hybrid systems.
  Trigger: recommendations, collaborative filtering, content-based, ML, personalization
tools:
  - Read
  - Write
  - Edit
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [recommendations, ml, personalization, algorithms]
  scope: ["**/recommendation/**"]
---

# Recommendation System Concepts

## Types of Recommendation Systems

### Collaborative Filtering
```
"Users who liked X also liked Y"

User-based CF:
1. Find users similar to target user
2. Recommend items those users liked
3. Weight by similarity score

Item-based CF:
1. Find items similar to items user liked
2. Recommend similar items
3. More scalable than user-based

Matrix Factorization:
- Decompose user-item matrix
- Learn latent factors
- SVD, ALS algorithms
```

### Content-Based Filtering
```
"Items similar to what you've liked"

Process:
1. Extract item features (TF-IDF, embeddings)
2. Build user profile from liked items
3. Match new items to user profile

Features:
- Text (descriptions, tags)
- Categories
- Attributes (color, size, brand)
- Embeddings (deep learning)
```

### Hybrid Systems
```
Combine multiple approaches:

Weighted:
  score = α * CF_score + β * CB_score

Switching:
  IF cold_start THEN content_based
  ELSE collaborative

Feature Combination:
  Use CF scores as features in ML model

Cascade:
  1. Filter with content-based
  2. Rank with collaborative
```

## Cold Start Problem

```
New User Cold Start:
- No interaction history
- Solutions:
  • Ask preferences on signup
  • Use demographic data
  • Popular items fallback
  • Content-based until enough data

New Item Cold Start:
- No user interactions
- Solutions:
  • Content-based similarity
  • Boost in exploration
  • Editorial placement
```

## Recommendation Scenarios

### E-commerce
```
Homepage:
- Trending products
- Personalized picks
- Recently viewed

Product Page:
- "Frequently bought together"
- "Customers also viewed"
- "Complete the look"

Cart:
- Cross-sell recommendations
- Bundle suggestions
```

### Content Platforms
```
Feed:
- Personalized content stream
- Explore/discover section

After consumption:
- "Up next"
- "More like this"
- Related content

Search:
- Personalized search results
- "You might also search for"
```

### Social Networks
```
People:
- "People you may know"
- "Follow suggestions"

Content:
- Personalized feed ranking
- Trending in your network

Groups:
- "Groups you might like"
- Activity suggestions
```

## Evaluation Metrics

### Offline Metrics
```
Accuracy:
- Precision@K: % of recommended items that are relevant
- Recall@K: % of relevant items that are recommended
- NDCG: Normalized discounted cumulative gain

Error:
- RMSE: Root mean square error (ratings)
- MAE: Mean absolute error

Ranking:
- MRR: Mean reciprocal rank
- AUC: Area under ROC curve
```

### Online Metrics
```
Engagement:
- Click-through rate (CTR)
- Conversion rate
- Time spent

Business:
- Revenue per user
- Items per order
- Return rate

Long-term:
- User retention
- Diversity of consumption
- Filter bubble effects
```

## A/B Testing Recommendations

```
Test design:
- Control: Existing algorithm
- Treatment: New algorithm
- Split: Random user assignment

Metrics to track:
- Primary: CTR or conversion
- Secondary: Revenue, engagement
- Guardrails: Page load time

Statistical considerations:
- Sample size for power
- Duration for effects
- Novelty effects
```

## Architecture Patterns

### Real-time vs Batch
```
Batch (pre-computed):
- Generate recommendations offline
- Store in cache/database
- Fast serving
- Updated periodically

Real-time:
- Compute on request
- Uses latest interactions
- More resource intensive
- Better personalization

Hybrid:
- Batch for base recommendations
- Real-time for re-ranking
- Periodic refresh
```

### Feature Store
```
Store and serve ML features:
- User features (preferences, history)
- Item features (attributes, embeddings)
- Context features (time, location)

Benefits:
- Consistency between training/serving
- Feature reuse across models
- Point-in-time correctness
```

## Data Requirements

```
Implicit feedback:
- Views, clicks, purchases
- Time spent
- Saves/bookmarks

Explicit feedback:
- Ratings
- Reviews
- Likes/dislikes

Context:
- Timestamp
- Device
- Location
- Session data
```

## Related Skills

- `recommendations-spring`: Spring Boot recommendation implementation
- `analytics-concepts`: Analytics for tracking interactions


