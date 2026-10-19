# GeoIP test databases

MaxMind's official test databases (github.com/maxmind/MaxMind-DB, `test-data/`; Apache-2.0 or MIT). They map a
few fixed addresses to fixed places, so geo tests use the real lookup code with known answers:

| IP | Country | Region | City | Other |
|---|---|---|---|---|
| 81.2.69.142 | GB | ENG | London | |
| 2.125.160.216 | GB | ENG | Boxford | postal OX1 |
| 216.160.83.56 | US | WA | Milton | postal 98354, DMA 819, ISP Century Link |
| 89.160.20.112 | SE | E | Linköping | ASN Bredband2 AB |
| 175.16.199.0 | CN | 22 | Changchun | |
| 202.196.224.0 | PH | | | |
| 2001:218::1 | JP | | | |
| 149.101.100.1 | US | | | Verizon Wireless (mobile carrier) |
| 10.0.0.1, 127.0.0.1 | — | | | unknown |

Never use them in production — they hold only these test ranges.
