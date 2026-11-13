# Quotation slice design

## Intent

Let office staff create defensible Point A-to-Point B trucking quotations from configured rates, obtain owner approval, and convert accepted work into dispatches. This extends the operational foundation without treating estimates as actual revenue.

## Approach

Use PostgreSQL functions for authoritative price calculation and status changes. A rate card contains base and distance rates per truck type. The creator enters distance and cost estimates with an explicit source label; all amounts are in PHP. The function snapshots each component into line items so later rate changes do not silently alter an approved quote. We considered a browser-only calculator, but it could be changed by a caller, and an external routing API is not configured. The office form will state that distance and costs are manual estimates until a routing provider is connected.

## Workflow

Owner/administrator configures a rate card. Dispatcher or owner creates a draft quotation. Owner/administrator approves it. Staff mark it sent, accepted, or rejected based on customer communication. An accepted quote converts atomically to one dispatch per quoted truck after available trucks and drivers are selected. All status changes are recorded. Converted quotes cannot be edited or converted again.

## Calculation

For each truck: base + (distance km × rate per km) + fuel + toll + labor + allowances + loading + overnight + other. Multiply by truck count. Add margin as a configured percentage of estimated cost, then tax as a configured percentage of price before tax; subtract an approved discount. Persist all inputs and the resulting breakdown. No unverified toll, fuel, or distance is labeled verified.

## Boundaries

No route provider key is available, so all distance entries are explicitly manual for this slice. No statutory tax percentage is hardcoded; tax is a configurable quote input. No automatic customer email or collected-revenue accounting is implied. PDF export uses the browser print flow with a dedicated print layout so staff can save it as PDF. Payroll and accounting are separate subsequent slices.
