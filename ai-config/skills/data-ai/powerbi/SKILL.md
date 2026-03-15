---
name: powerbi
description: >
  Power BI business intelligence with DAX measures, Power Query transformations, and dashboard design patterns.
  Trigger: powerbi, dax, business intelligence, dashboard, analytics, reporting, power query
tools:
  - Read
  - Write
  - Bash
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [powerbi, dax, analytics, dashboards]
  updated: "2026-02"
---

# Power BI Business Intelligence

## Data Architecture

```
SOURCES                     DATAFLOW                    REPORTS
+---------------+          +---------------+          +---------------+
| PostgreSQL    |          | ETL           |          | Executive     |
| API REST      |   --->   | Dimensional   |   --->   | Dashboard     |
| Excel/CSV     |          | Model         |          | Analysis      |
+---------------+          +---------------+          +---------------+
```

## Star Schema Model

```
                    DimSensor
                        |
DimPlant     FactReadings     DimDate
    |              |              |
    +------+-------+-------+------+
           |               |
      FactAlerts       DimTime
           |
    DimAlertType
```

## Power Query (M)

### PostgreSQL Connection

```m
// Query: Sensors
let
    Source = PostgreSQL.Database("server", "database"),
    sensors = Source{[Schema="public", Item="sensors"]}[Data],

    // Filter and rename
    FilteredRows = Table.SelectRows(sensors, each [status] = "active"),
    RenamedColumns = Table.RenameColumns(FilteredRows, {
        {"id", "SensorID"},
        {"name", "SensorName"}
    }),

    // Add key
    AddedKey = Table.AddIndexColumn(RenamedColumns, "SensorKey", 1, 1, Int64.Type)
in
    AddedKey
```

### REST API Connection

```m
// Query: Metrics
let
    BaseUrl = "https://api.example.com/v1",
    Token = GetSecret("API_TOKEN"),

    GetPage = (page as number) as table =>
        let
            Response = Web.Contents(
                BaseUrl & "/metrics",
                [
                    Headers = [Authorization = "Bearer " & Token],
                    Query = [page = Text.From(page), limit = "1000"]
                ]
            ),
            Json = Json.Document(Response),
            AsTable = Table.FromRecords(Json[data])
        in
            AsTable,

    // Paginate
    AllPages = List.Generate(
        () => [Page = 1, Data = GetPage(1)],
        each Table.RowCount([Data]) > 0,
        each [Page = [Page] + 1, Data = GetPage([Page] + 1)],
        each [Data]
    ),

    Combined = Table.Combine(AllPages)
in
    Combined
```

### Date Dimension

```m
// Query: DimDate
let
    StartDate = #date(2020, 1, 1),
    EndDate = Date.AddYears(DateTime.Date(DateTime.LocalNow()), 1),

    DateList = List.Dates(StartDate, Duration.Days(EndDate - StartDate), #duration(1,0,0,0)),
    DateTable = Table.FromList(DateList, Splitter.SplitByNothing(), {"Date"}),

    AddYear = Table.AddColumn(DateTable, "Year", each Date.Year([Date]), Int64.Type),
    AddMonth = Table.AddColumn(AddYear, "Month", each Date.Month([Date]), Int64.Type),
    AddMonthName = Table.AddColumn(AddMonth, "MonthName", each Date.MonthName([Date])),
    AddWeek = Table.AddColumn(AddMonthName, "Week", each Date.WeekOfYear([Date]), Int64.Type),
    AddIsWeekend = Table.AddColumn(AddWeek, "IsWeekend", each Date.DayOfWeek([Date]) >= 5),

    AddKey = Table.AddColumn(AddIsWeekend, "DateKey",
        each Date.Year([Date]) * 10000 + Date.Month([Date]) * 100 + Date.Day([Date]),
        Int64.Type
    )
in
    AddKey
```

### Time Dimension

```m
// Query: DimTime
let
    Minutes = List.Generate(() => 0, each _ < 1440, each _ + 1),
    ToTable = Table.FromList(Minutes, Splitter.SplitByNothing(), {"MinuteOfDay"}),

    AddHour = Table.AddColumn(ToTable, "Hour", each Number.IntegerDivide([MinuteOfDay], 60)),
    AddMinute = Table.AddColumn(AddHour, "Minute", each Number.Mod([MinuteOfDay], 60)),

    AddShift = Table.AddColumn(AddMinute, "Shift", each
        if [Hour] >= 6 and [Hour] < 14 then "Morning"
        else if [Hour] >= 14 and [Hour] < 22 then "Afternoon"
        else "Night"
    ),

    AddKey = Table.AddColumn(AddShift, "TimeKey", each [Hour] * 100 + [Minute], Int64.Type)
in
    AddKey
```

## DAX Measures

### Basic Metrics

```dax
// Average
Avg Reading = AVERAGE(FactReadings[Value])

// Current (latest)
Current Reading =
CALCULATE(
    MAX(FactReadings[Value]),
    FILTER(ALL(DimDate), DimDate[DateKey] = MAX(DimDate[DateKey]))
)

// Percentage change
Reading Change % =
VAR CurrentValue = [Avg Reading]
VAR PreviousValue = CALCULATE([Avg Reading], DATEADD(DimDate[Date], -1, DAY))
RETURN
    IF(ISBLANK(PreviousValue), BLANK(),
       DIVIDE(CurrentValue - PreviousValue, PreviousValue))

// In range percentage
In Range % =
VAR InRange = CALCULATE(COUNTROWS(FactReadings),
    FactReadings[Value] >= RELATED(DimSensor[MinValue]),
    FactReadings[Value] <= RELATED(DimSensor[MaxValue])
)
VAR Total = COUNTROWS(FactReadings)
RETURN DIVIDE(InRange, Total)
```

### Alert Metrics

```dax
// Active alerts
Active Alerts = CALCULATE(COUNTROWS(FactAlerts), FactAlerts[Status] = "active")

// Critical alerts
Critical Alerts = CALCULATE(COUNTROWS(FactAlerts),
    RELATED(DimAlertType[Severity]) = "critical")

// MTTR (Mean Time To Resolve)
MTTR Hours = AVERAGEX(
    FILTER(FactAlerts, FactAlerts[ResolvedAt] <> BLANK()),
    DATEDIFF(FactAlerts[TriggeredAt], FactAlerts[ResolvedAt], HOUR)
)

// Acknowledgement rate
Ack Rate % =
VAR Acked = CALCULATE(COUNTROWS(FactAlerts), FactAlerts[AckedAt] <> BLANK())
VAR Total = COUNTROWS(FactAlerts)
RETURN DIVIDE(Acked, Total)
```

### Time Intelligence

```dax
// Year to Date
Production YTD = CALCULATE([Total Production], DATESYTD(DimDate[Date]))

// Month to Date
Production MTD = CALCULATE([Total Production], DATESMTD(DimDate[Date]))

// Same Period Last Year
Production SPLY = CALCULATE([Total Production], SAMEPERIODLASTYEAR(DimDate[Date]))

// Year over Year growth
YoY Growth % =
VAR Current = [Total Production]
VAR LastYear = [Production SPLY]
RETURN DIVIDE(Current - LastYear, LastYear)

// 7-day Moving Average
Production MA7 =
CALCULATE(
    [Total Production],
    DATESINPERIOD(DimDate[Date], MAX(DimDate[Date]), -7, DAY)
) / 7
```

### Using Variables

```dax
// Good: Use variables
Margin % =
VAR Revenue = SUM(Sales[Amount])
VAR Cost = SUM(Sales[Cost])
RETURN DIVIDE(Revenue - Cost, Revenue)

// Bad: Calculates twice
Margin % = DIVIDE(
    SUM(Sales[Amount]) - SUM(Sales[Cost]),
    SUM(Sales[Amount])
)
```

## Dashboard Layout

### Executive Dashboard

```
+----------------------------------------------------------+
|                    EXECUTIVE DASHBOARD                     |
+----------+----------+----------+----------+---------------+
|  KPI 1   |  KPI 2   |  KPI 3   |  KPI 4   |   Trend       |
|   Card   |   Card   |   Card   |   Card   |   Indicator   |
+----------+----------+----------+----------+---------------+
|                                                           |
|              MAIN CHART (Time Series)                     |
|                                                           |
+--------------------------+--------------------------------+
|                          |                                |
|  BREAKDOWN               |  TOP 5 TABLE                   |
|  (Bar Chart)             |  (Conditional Formatting)      |
|                          |                                |
+--------------------------+--------------------------------+
```

## Visualizations Guide

| Metric Type | Visual | Configuration |
|-------------|--------|---------------|
| Single KPI | Card | Value + Trend + Indicator |
| Progress | Gauge | Color thresholds |
| Time comparison | Line Chart | With area for ranges |
| Distribution | Donut Chart | Max 5 categories |
| Ranking | Bar Chart | Horizontal, sorted |
| Correlation | Scatter Plot | With trendline |
| Location | Map | Bubbles by size |
| Detail | Table/Matrix | Conditional formatting |

## Color Standards

```
// Status colors
Green (OK):     #2DD36F
Yellow (Warn):  #FFC409
Red (Error):    #EB445A
Gray (Offline): #92949C

// Trend colors
Positive: #2DD36F
Negative: #EB445A
Neutral:  #3DC2FF

// Brand
Primary:   #0969FF
Secondary: #3DC2FF
```

## Row-Level Security

### By Tenant

```dax
// Role: TenantAccess
// Table: DimPlant
[TenantID] = USERPRINCIPALNAME()
```

### By Plant

```dax
// Role: PlantManager
// Table: DimPlant
[PlantID] IN
    SELECTCOLUMNS(
        FILTER(UserPlantAccess,
            UserPlantAccess[UserEmail] = USERPRINCIPALNAME()),
        "PlantID", UserPlantAccess[PlantID]
    )
```

## Refresh Configuration

```yaml
Type: Incremental Refresh

Policy:
  - Last 7 days: Full refresh every 1 hour
  - Last 30 days: Daily refresh at 6:00 AM
  - Historical (>30 days): Initial load only

Dataflow:
  - Refresh: Every 4 hours
  - Timeout: 2 hours
  - Retry: 3 attempts
```

## Best Practices

1. **Star Schema** - Dimensional model with fact and dimension tables
2. **Measures over Calculated Columns** - For aggregations, use measures
3. **Avoid unnecessary CALCULATE** - Simple aggregations don't need it
4. **Use Variables** - More readable and efficient
5. **Incremental Refresh** - For large datasets

## Related Skills

- `duckdb-analytics`: Data preprocessing
- `timescaledb`: Time-series data source
- `technical-docs`: Report documentation
