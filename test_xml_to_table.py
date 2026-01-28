import unittest
import xml.etree.ElementTree as ET
from xml_to_table import (
    strip_ns,
    flatten_element,
    normalize_row,
    find_bl_key,
    add_value,
    find_bl_value
)

class TestXmlToTable(unittest.TestCase):

    def test_strip_ns(self):
        self.assertEqual(strip_ns("{http://example.com}tag"), "tag")
        self.assertEqual(strip_ns("tag"), "tag")
        self.assertEqual(strip_ns("{}tag"), "tag")

    def test_add_value(self):
        data = {}
        add_value(data, "key", "value1")
        self.assertEqual(data["key"], "value1")

        add_value(data, "key", "value2")
        self.assertEqual(data["key"], ["value1", "value2"])

        add_value(data, "key", "value3")
        self.assertEqual(data["key"], ["value1", "value2", "value3"])

    def test_flatten_element_simple(self):
        # <Item id="1">Value</Item>
        elem = ET.Element("Item", attrib={"id": "1"})
        elem.text = "Value"

        result = flatten_element(elem)
        expected = {
            "@id": "1",
            "Item": "Value"
        }
        self.assertEqual(result, expected)

    def test_flatten_element_nested(self):
        # <Parent>
        #   <Child>C1</Child>
        #   <Child>C2</Child>
        # </Parent>
        parent = ET.Element("Parent")
        c1 = ET.SubElement(parent, "Child")
        c1.text = "C1"
        c2 = ET.SubElement(parent, "Child")
        c2.text = "C2"

        result = flatten_element(parent)
        expected = {
            "Child": ["C1", "C2"]
        }
        self.assertEqual(result, expected)

    def test_flatten_element_mixed(self):
        # <Node type="A">
        #   <Sub>Text</Sub>
        #   Tail
        # </Node>

        node = ET.Element("Node", attrib={"type": "A"})
        sub = ET.SubElement(node, "Sub")
        sub.text = "Text"
        node.text = "Main" # It adds _text if there are children

        result = flatten_element(node)
        expected = {
            "@type": "A",
            "Sub": "Text",
            "_text": "Main"
        }
        self.assertEqual(result, expected)

    def test_normalize_row(self):
        row = {
            "a": "val",
            "b": ["v1", "v2"],
            "c": None,
            "d": 123
        }
        result = normalize_row(row)
        expected = {
            "a": "val",
            "b": "v1; v2",
            "c": "",
            "d": "123"
        }
        self.assertEqual(result, expected)

    def test_find_bl_key(self):
        row1 = {"Some.TrnspCtrId": "123"}
        self.assertEqual(find_bl_key(row1), "Some.TrnspCtrId")

        row2 = {"TrnspCtrId": "456"}
        self.assertEqual(find_bl_key(row2), "TrnspCtrId")

        row3 = {"Other": "X"}
        self.assertEqual(find_bl_key(row3), "")

        row4 = {"@TrnspCtrId": "789"}
        self.assertEqual(find_bl_key(row4), "@TrnspCtrId")

    def test_find_bl_value(self):
        # <Root>
        #   <TrnspCtrId>BL123</TrnspCtrId>
        #   <Item>
        #     <SubItem>Value</SubItem>
        #   </Item>
        # </Root>

        root = ET.Element("Root")
        bl = ET.SubElement(root, "TrnspCtrId")
        bl.text = "BL123"
        item = ET.SubElement(root, "Item")
        sub_item = ET.SubElement(item, "SubItem")
        sub_item.text = "Value"

        parent_map = {bl: root, item: root, sub_item: item}

        val = find_bl_value(sub_item, parent_map)
        self.assertEqual(val, "BL123")

if __name__ == "__main__":
    unittest.main()
