"""Extract only supplied GTFS stop geometry for the offline service artifact."""
import posixpath
import zipfile
from collections import defaultdict
from io import BytesIO
from math import isfinite
from xml.etree import ElementTree


MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"


def _text(cell, shared):
    value = cell.find(f"{{{MAIN}}}v")
    if value is None:
        return ""
    return shared[int(value.text)] if cell.get("t") == "s" else value.text


def _sheet(archive, name):
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    sheet = next(item for item in workbook.findall(f".//{{{MAIN}}}sheet") if item.get("name") == name)
    relationships = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    target = next(item.get("Target") for item in relationships.findall(f"{{{PACKAGE_REL}}}Relationship") if item.get("Id") == sheet.get(f"{{{REL}}}id"))
    return posixpath.normpath(posixpath.join("xl", target))


def build(path):
    with zipfile.ZipFile(path) as outer:
        member = next((item for item in outer.namelist() if item.endswith(".xlsx") and "справочники" in item), None)
        if member is None:
            raise ValueError("reference archive has no tram directory XLSX")
        workbook_bytes = outer.read(member)
    with zipfile.ZipFile(BytesIO(workbook_bytes)) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ["".join(item.itertext()) for item in ElementTree.fromstring(archive.read("xl/sharedStrings.xml")).findall(f"{{{MAIN}}}si")]
        root = ElementTree.fromstring(archive.read(_sheet(archive, "Порядок_с_координатами")))
    rows = [[_text(cell, shared) for cell in row.findall(f"{{{MAIN}}}c")] for row in root.findall(f".//{{{MAIN}}}row")]
    header, values = rows[0], rows[1:]
    index = {name: header.index(name) for name in ("route_short_name", "trip_id", "direction_id", "stop_sequence", "stop_id", "stop_name", "stop_lat", "stop_lon")}
    trips = defaultdict(list)
    for row in values:
        if len(row) < len(header) or row[index["route_short_name"]] not in {"1", "5", "7", "11", "12"}:
            continue
        route = int(row[index["route_short_name"]])
        lat, lon = float(row[index["stop_lat"]]), float(row[index["stop_lon"]])
        if not row[index["stop_id"]] or not isfinite(lat) or not isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
            raise ValueError("reference map has invalid stop coordinates")
        trips[(route, row[index["trip_id"]], row[index["direction_id"]])].append({
            "stop_id": row[index["stop_id"]], "name": row[index["stop_name"]],
            "lat": lat, "lon": lon, "sequence": int(row[index["stop_sequence"]]),
        })
    routes = defaultdict(list)
    for (route, trip_id, direction), stops in trips.items():
        routes[route].append({"trip_id": trip_id, "direction": direction, "stops": sorted(stops, key=lambda item: item["sequence"])})
    return {"schema_version": 1, "source": "GTFS Порядок_с_координатами", "forecast_available": False,
            "note": "Reference geometry only; no stop-linked boarding target is available.",
            "routes": [{"route": route, "trips": routes[route]} for route in sorted(routes)]}
