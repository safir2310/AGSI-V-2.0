#!/usr/bin/env python3
"""Decode the merchant's static QRIS poster -> EMVCo payload string.

Prints the raw payload, a TLV breakdown, and validates the QRIS structure
(GUI domain, NMID, CRC16). The payload itself is public (printed on the
merchant's poster) — safe to store in .env as QRIS_STATIS_PAYLOAD.
"""
import sys
import cv2

IMG = "/home/z/my-project/upload/1794105607429.png"


def crc16_ccitt(s: str) -> str:
    crc = 0xFFFF
    for ch in s.encode("ascii"):
        crc ^= ch << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return f"{crc:04X}"


def parse_tlv(payload: str, start=0, end=None):
    """Parse top-level TLV records -> list of (id, value)."""
    out = []
    i = start
    if end is None:
        end = len(payload)
    while i + 4 <= end:
        tid = payload[i:i + 2]
        ln = int(payload[i + 2:i + 4])
        val = payload[i + 4:i + 4 + ln]
        if len(val) < ln:
            break
        out.append((tid, val))
        i += 4 + ln
    return out


def main():
    img = cv2.imread(IMG)
    if img is None:
        print("FATAL: cannot read image", file=sys.stderr)
        sys.exit(1)
    detector = cv2.QRCodeDetector()
    payload, pts, _ = detector.detectAndDecode(img)
    if not payload:
        # fallback: try pyzbar
        from pyzbar.pyzbar import decode as zbar_decode
        from PIL import Image
        found = zbar_decode(Image.open(IMG))
        if not found:
            print("FATAL: no QR decoded", file=sys.stderr)
            sys.exit(1)
        payload = found[0].data.decode("ascii")

    payload = payload.strip()
    print(f"PAYLOAD_LEN={len(payload)}")
    print(f"PAYLOAD={payload}")

    tags = parse_tlv(payload)
    print("\n--- TLV breakdown (top level) ---")
    for tid, val in tags:
        print(f"  {tid} ({len(val):3d}) = {val[:70]}")

    # nested: 26 / 51 merchant account info, 62 additional data
    for parent in ("26", "51", "62"):
        for tid, val in tags:
            if tid == parent:
                print(f"\n--- nested {parent} ---")
                for nid, nval in parse_tlv(val):
                    print(f"  {parent}-{nid} = {nval[:70]}")

    # validation
    d = dict(tags)
    ok = True
    if d.get("00") != "01":
        print("WARN: payload format indicator != 01", d.get("00")); ok = False
    gui = ""
    for tid, val in tags:
        if tid in ("26", "51"):
            n = dict(parse_tlv(val))
            if n.get("00") == "ID.CO.QRIS.WWW":
                gui = n.get("01", "")
                print(f"\nQRIS GUI OK — PAN={n.get('01')} NMID={n.get('02')} criteria={n.get('03')}")
    if not gui:
        print("WARN: QRIS domain not found"); ok = False
    crc_field = payload[-4:]
    calc = crc16_ccitt(payload[:-4])
    if crc_field == calc:
        print(f"CRC OK ({calc})")
    else:
        print(f"CRC MISMATCH: in payload={crc_field} calculated={calc}"); ok = False
    print(f"\nPOI(01)={d.get('01', '(absent -> static)')} amount(54)={d.get('54', '(absent)')}")
    print(f"MERCHANT(59)={d.get('59')} CITY(60)={d.get('60')} MCC(52)={d.get('52')} CURRENCY(53)={d.get('53')}")
    print("VALID" if ok else "INVALID")


if __name__ == "__main__":
    main()
