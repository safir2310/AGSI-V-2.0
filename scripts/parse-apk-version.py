#!/usr/bin/env python3
"""
Baca android:versionCode & versionName langsung dari AndroidManifest.xml
binary di dalam APK (parser AXML minimal, tanpa dependensi).

Pemakaian: python3 scripts/parse-apk-version.py <file.apk>
"""
import struct
import sys
import zipfile


def parse_string_pool(data: bytes, offset: int):
    """StringPool chunk: kembalikan (daftar string, offset akhir chunk).
    Tiap entri: prefix panjang + isi + TERMINATOR (u16 utk UTF-16, u8 utk
    UTF-8) — terminator WAJIB dilewati atau semua indeks bergeser."""
    _, _, size = struct.unpack_from("<HHI", data, offset)
    str_count, style_count, flags, str_start, style_start = struct.unpack_from(
        "<IIIII", data, offset + 8
    )
    is_utf8 = bool(flags & (1 << 8))
    strings = []
    pos = offset + str_start
    for _ in range(str_count):
        if is_utf8:
            # u8len karakter (1-2 byte) lalu u8len byte data (1-2 byte)
            n = data[pos]; pos += 1
            if n & 0x80:
                pos += 1
            nbytes = data[pos]; pos += 1
            if nbytes & 0x80:
                nbytes = ((nbytes & 0x7F) << 8) | data[pos]
                pos += 1
            s = data[pos : pos + nbytes].decode("utf-8", "replace")
            pos += nbytes + 1  # + terminator u8
        else:
            n = struct.unpack_from("<H", data, pos)[0]
            pos += 2
            if n & 0x8000:
                n = ((n & 0x7FFF) << 16) | struct.unpack_from("<H", data, pos)[0]
                pos += 2
            s = data[pos : pos + n * 2].decode("utf-16-le", "replace")
            pos += n * 2 + 2  # + terminator u16
        strings.append(s)
    return strings, offset + size


def main(path: str) -> int:
    with zipfile.ZipFile(path) as z:
        data = z.read("AndroidManifest.xml")

    # header file XML + StringPool pertama
    _, _, file_size = struct.unpack_from("<HHI", data, 0)
    strings, pool_end = parse_string_pool(data, 8)

    # pindai chunk StartElement (0x0102) cari atribut versionCode/versionName
    pos = pool_end
    version_code = version_name = None
    while pos < len(data) - 8:
        ctype, hsize, csize = struct.unpack_from("<HHI", data, pos)
        if csize < 8:
            break
        if ctype == 0x0102:  # START_ELEMENT
            # ResXMLTree_node header (16B) + attrExt mulai node+16:
            # ns(4) name(4) attributeStart(2) attributeSize(2) attributeCount(2)
            # attributeStart RELATIF ke attrExt → atribut di node+16+attrStart
            attr_start = struct.unpack_from("<H", data, pos + 24)[0]
            attr_count = struct.unpack_from("<H", data, pos + 28)[0]
            attrs_at = pos + 16 + attr_start
            for i in range(attr_count):
                a = attrs_at + i * 20
                if a + 20 > len(data):
                    break  # pengaman: jangan baca melewati buffer
                # ResXMLTree_attribute (20 byte): ns, name, rawValue,
                # typedValue {size(2), res0(1), type(1), data(4)}
                _ns, name_idx, _raw, _sz, _r0, dtype, dval = struct.unpack_from(
                    "<IIIHBBI", data, a
                )
                name = strings[name_idx] if name_idx < len(strings) else ""
                if name == "versionCode" and dtype == 0x10:  # TYPE_INT_DEC
                    version_code = dval
                if name == "versionName" and dtype == 0x03:  # TYPE_STRING
                    version_name = strings[dval] if dval < len(strings) else None
        pos += csize

    if version_code is None:
        print("versionCode tidak ditemukan di", path)
        return 1
    print(f"{path}")
    print(f"  versionCode : {version_code}")
    print(f"  versionName : {version_name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
