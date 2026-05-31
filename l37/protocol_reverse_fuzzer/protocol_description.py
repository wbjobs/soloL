import os
from typing import List, Dict, Optional
from dataclasses import dataclass, field
from datetime import datetime
import xml.etree.ElementTree as ET
from xml.dom import minidom

try:
    from lxml import etree
    LXML_AVAILABLE = True
except ImportError:
    LXML_AVAILABLE = False

from .protocol_inference import Field
from .packet_clustering import Cluster


@dataclass
class MessageType:
    name: str
    cluster_id: int
    fields: List[Field] = field(default_factory=list)
    representative: bytes = b""
    description: str = ""

    def to_dict(self) -> Dict:
        return {
            "name": self.name,
            "cluster_id": self.cluster_id,
            "representative_hex": self.representative.hex(),
            "description": self.description,
            "field_count": len(self.fields),
            "fields": [f.to_dict() for f in self.fields]
        }


class ProtocolDescription:
    def __init__(self, protocol_name: str = "UnknownProtocol"):
        self.protocol_name = protocol_name
        self.message_types: List[MessageType] = []
        self.metadata: Dict = {}
        self.generated_at: Optional[str] = None

    def build_from_clusters(self, clusters: Dict[int, Cluster],
                            inference_results: Dict[int, List[Field]]) -> None:
        self.message_types = []

        for cluster_id, cluster in clusters.items():
            if cluster_id == -1:
                continue

            fields = inference_results.get(cluster_id, [])
            msg_type = MessageType(
                name=f"MessageType_{cluster_id:02d}",
                cluster_id=cluster_id,
                fields=fields,
                representative=cluster.representative,
                description=f"Cluster {cluster_id} with {len(cluster.packets)} packets"
            )
            self.message_types.append(msg_type)

        self.metadata["total_message_types"] = len(self.message_types)
        self.metadata["total_clusters"] = len(clusters)
        self.metadata["noise_packets"] = len(clusters.get(-1, Cluster(-1)).packets)

    def set_metadata(self, capture_stats: Optional[Dict] = None,
                     clustering_params: Optional[Dict] = None,
                     inference_params: Optional[Dict] = None) -> None:
        if capture_stats:
            self.metadata["capture"] = capture_stats
        if clustering_params:
            self.metadata["clustering"] = clustering_params
        if inference_params:
            self.metadata["inference"] = inference_params

        self.metadata["generated_at"] = datetime.now().isoformat()

    def generate_xml(self, filename: Optional[str] = None) -> str:
        self.generated_at = datetime.now().isoformat()

        root = ET.Element("protocol")
        root.set("name", self.protocol_name)
        root.set("version", "1.0")
        root.set("generated_at", self.generated_at)

        metadata_elem = ET.SubElement(root, "metadata")
        for key, value in self.metadata.items():
            if isinstance(value, dict):
                sub_elem = ET.SubElement(metadata_elem, key)
                for sub_key, sub_value in value.items():
                    item = ET.SubElement(sub_elem, "item")
                    item.set("name", sub_key)
                    item.text = str(sub_value)
            else:
                item = ET.SubElement(metadata_elem, "item")
                item.set("name", key)
                item.text = str(value)

        message_types_elem = ET.SubElement(root, "message_types")

        for msg_type in self.message_types:
            msg_elem = ET.SubElement(message_types_elem, "message_type")
            msg_elem.set("name", msg_type.name)
            msg_elem.set("cluster_id", str(msg_type.cluster_id))
            msg_elem.set("description", msg_type.description)

            rep_elem = ET.SubElement(msg_elem, "representative")
            rep_elem.set("hex", msg_type.representative.hex())
            rep_elem.set("length", str(len(msg_type.representative)))
            rep_elem.text = self._bytes_to_ascii(msg_type.representative)

            fields_elem = ET.SubElement(msg_elem, "fields")

            for field in sorted(msg_type.fields, key=lambda f: f.offset):
                field_elem = ET.SubElement(fields_elem, "field")
                field_elem.set("name", field.name)
                field_elem.set("offset", str(field.offset))
                field_elem.set("length", str(field.length))
                field_elem.set("type", field.field_type)
                field_elem.set("entropy", f"{field.entropy:.4f}")
                field_elem.set("is_fixed", str(field.is_fixed).lower())
                field_elem.set("is_length", str(field.is_length).lower())
                field_elem.set("is_checksum", str(field.is_checksum).lower())

                if field.description:
                    desc_elem = ET.SubElement(field_elem, "description")
                    desc_elem.text = field.description

                values_elem = ET.SubElement(field_elem, "values")
                unique_values = list(set(field.values))[:10]
                for i, val in enumerate(unique_values):
                    val_elem = ET.SubElement(values_elem, "value")
                    val_elem.set("index", str(i))
                    val_elem.set("hex", val.hex())
                    val_elem.text = self._bytes_to_ascii(val)

                constraints_elem = ET.SubElement(field_elem, "fuzzing_constraints")
                if field.is_fixed:
                    constraints_elem.set("mutable", "false")
                    constraints_elem.set("fixed_value", field.values[0].hex())
                else:
                    constraints_elem.set("mutable", "true")
                    if field.is_length:
                        constraints_elem.set("auto_correct", "length")
                    elif field.is_checksum:
                        constraints_elem.set("auto_correct", "checksum")

        xml_str = self._prettify_xml(root)

        if filename:
            self._save_xml(xml_str, filename)

        return xml_str

    def _bytes_to_ascii(self, data: bytes) -> str:
        result = []
        for b in data:
            if 32 <= b < 127:
                result.append(chr(b))
            else:
                result.append('.')
        return ''.join(result)

    def _prettify_xml(self, root: ET.Element) -> str:
        rough_string = ET.tostring(root, 'utf-8')
        reparsed = minidom.parseString(rough_string)
        return reparsed.toprettyxml(indent="  ")

    def _save_xml(self, xml_content: str, filename: str) -> None:
        if not filename.endswith('.xml'):
            filename += '.xml'

        with open(filename, 'w', encoding='utf-8') as f:
            f.write(xml_content)

    def load_xml(self, filename: str) -> None:
        if not os.path.exists(filename):
            raise FileNotFoundError(f"XML file not found: {filename}")

        tree = ET.parse(filename)
        root = tree.getroot()

        self.protocol_name = root.get("name", "UnknownProtocol")
        self.generated_at = root.get("generated_at", "")

        self.message_types = []
        for msg_elem in root.findall(".//message_type"):
            msg_type = MessageType(
                name=msg_elem.get("name", ""),
                cluster_id=int(msg_elem.get("cluster_id", "-1")),
                description=msg_elem.get("description", "")
            )

            rep_elem = msg_elem.find("representative")
            if rep_elem is not None:
                rep_hex = rep_elem.get("hex", "")
                msg_type.representative = bytes.fromhex(rep_hex) if rep_hex else b""

            fields_elem = msg_elem.find("fields")
            if fields_elem is not None:
                for field_elem in fields_elem.findall("field"):
                    field = Field(
                        name=field_elem.get("name", ""),
                        offset=int(field_elem.get("offset", "0")),
                        length=int(field_elem.get("length", "0")),
                        field_type=field_elem.get("type", "unknown"),
                        entropy=float(field_elem.get("entropy", "0.0")),
                        is_fixed=field_elem.get("is_fixed", "false").lower() == "true",
                        is_length=field_elem.get("is_length", "false").lower() == "true",
                        is_checksum=field_elem.get("is_checksum", "false").lower() == "true"
                    )

                    desc_elem = field_elem.find("description")
                    if desc_elem is not None and desc_elem.text:
                        field.description = desc_elem.text

                    values_elem = field_elem.find("values")
                    if values_elem is not None:
                        for val_elem in values_elem.findall("value"):
                            val_hex = val_elem.get("hex", "")
                            if val_hex:
                                field.values.append(bytes.fromhex(val_hex))

                    msg_type.fields.append(field)

            self.message_types.append(msg_type)

    def generate_fuzzer_config(self) -> Dict:
        config = {
            "protocol_name": self.protocol_name,
            "message_types": []
        }

        for msg_type in self.message_types:
            msg_config = {
                "name": msg_type.name,
                "cluster_id": msg_type.cluster_id,
                "template": msg_type.representative.hex(),
                "fields": []
            }

            for field in sorted(msg_type.fields, key=lambda f: f.offset):
                field_config = {
                    "name": field.name,
                    "offset": field.offset,
                    "length": field.length,
                    "type": field.field_type,
                    "mutable": not field.is_fixed,
                    "is_length": field.is_length,
                    "is_checksum": field.is_checksum,
                    "sample_values": [v.hex() for v in field.values[:10]]
                }
                msg_config["fields"].append(field_config)

            config["message_types"].append(msg_config)

        return config

    def get_summary(self) -> Dict:
        total_fields = sum(len(m.fields) for m in self.message_types)
        return {
            "protocol_name": self.protocol_name,
            "generated_at": self.generated_at,
            "message_type_count": len(self.message_types),
            "total_fields": total_fields,
            "message_types": [mt.to_dict() for mt in self.message_types]
        }

    def visualize_protocol(self) -> str:
        lines = [f"Protocol: {self.protocol_name}"]
        lines.append("=" * 60)
        lines.append(f"Generated at: {self.generated_at}")
        lines.append(f"Message Types: {len(self.message_types)}")
        lines.append("")

        for msg_type in self.message_types:
            lines.append(f"  {msg_type.name} (Cluster {msg_type.cluster_id})")
            lines.append(f"  {msg_type.description}")
            lines.append(f"  Representative: {msg_type.representative[:32].hex()}")
            lines.append("  Fields:")

            for field in sorted(msg_type.fields, key=lambda f: f.offset):
                markers = []
                if field.is_fixed:
                    markers.append("FIXED")
                if field.is_length:
                    markers.append("LENGTH")
                if field.is_checksum:
                    markers.append("CHECKSUM")

                marker_str = f" [{', '.join(markers)}]" if markers else ""

                lines.append(
                    f"    [{field.offset:4d}:{field.length:3d}] "
                    f"{field.name:20s} "
                    f"{field.field_type:15s} "
                    f"entropy={field.entropy:.3f}{marker_str}"
                )

            lines.append("")

        return "\n".join(lines)
