import {
  Body, Container, Column, Head, Heading, Html, Preview, Row, Section, Text,
} from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface Customer {
  business: string;
  contact: string;
  phone: string;
  email: string;
}

interface Props {
  monthLabel?: string;
  customers?: Customer[];
}

const CustomersDueNextMonthEmail = ({ monthLabel = "next month", customers = [] }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
      <Preview>{`${customers.length} customer(s) due in ${monthLabel}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Customers due in {monthLabel}</Heading>
        <Text style={text}>
          The following {customers.length} customer{customers.length === 1 ? " is" : "s are"} scheduled
          for service next month.
        </Text>

        {customers.length > 0 ? (
          <Section style={tableWrap}>
            <Row style={headerRow}>
              <Column style={{ ...thCell, width: "30%" }}>Business</Column>
              <Column style={{ ...thCell, width: "22%" }}>Contact</Column>
              <Column style={{ ...thCell, width: "22%" }}>Phone</Column>
              <Column style={{ ...thCell, width: "26%" }}>Email</Column>
            </Row>
            {customers.map((c, i) => (
              <Row key={i} style={i % 2 === 0 ? rowEven : rowOdd}>
                <Column style={{ ...tdCell, width: "30%" }}>{c.business || "—"}</Column>
                <Column style={{ ...tdCell, width: "22%" }}>{c.contact || "—"}</Column>
                <Column style={{ ...tdCell, width: "22%" }}>{c.phone || "—"}</Column>
                <Column style={{ ...tdCell, width: "26%" }}>{c.email || "—"}</Column>
              </Row>
            ))}
          </Section>
        ) : (
          <Text style={text}>No customers scheduled.</Text>
        )}

        <Text style={footer}>Inspection Clean — automated monthly schedule</Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: CustomersDueNextMonthEmail,
  subject: (d: Record<string, any>) =>
    `Customers due in ${d?.monthLabel ?? "next month"}`,
  to: "service@inspectionclean.com",
  displayName: "Monthly customers due",
  previewData: {
    monthLabel: "November 2026",
    customers: [
      { business: "Roma's Family Restaurant - Woodruff", contact: "Adele", phone: "(864) 357-1500", email: "adele@example.com" },
    ],
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "24px", maxWidth: "640px", margin: "0 auto" };
const h1 = { fontSize: "22px", fontWeight: "bold", color: "#0f3a9f", margin: "0 0 12px" };
const text = { fontSize: "14px", color: "#212529", lineHeight: "1.5", margin: "0 0 16px" };
const tableWrap = { border: "1px solid #e6e8eb", borderRadius: "6px", overflow: "hidden", margin: "8px 0 16px" };
const headerRow = { backgroundColor: "#0f3a9f" };
const thCell = { padding: "10px 12px", color: "#ffffff", fontWeight: "bold", fontSize: "13px", textAlign: "left" as const };
const tdCell = { padding: "10px 12px", color: "#212529", fontSize: "13px", borderTop: "1px solid #eef0f2" };
const rowEven = { backgroundColor: "#ffffff" };
const rowOdd = { backgroundColor: "#f7f9fc" };
const footer = { fontSize: "12px", color: "#6b7280", margin: "20px 0 0" };
