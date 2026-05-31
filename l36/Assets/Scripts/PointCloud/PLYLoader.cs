using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;
using LiDARFurniturePlacer.Core;

namespace LiDARFurniturePlacer.PointCloud
{
    public class PLYLoader
    {
        private enum PlyFormat
        {
            Ascii,
            BinaryLittleEndian,
            BinaryBigEndian
        }

        private class PlyProperty
        {
            public string Name;
            public string Type;
            public bool IsList;
            public string ListCountType;
        }

        private class PlyElement
        {
            public string Name;
            public int Count;
            public List<PlyProperty> Properties = new List<PlyProperty>();
        }

        public PointCloudData Load(string filePath)
        {
            if (!File.Exists(filePath))
            {
                Debug.LogError($"PLY file not found: {filePath}");
                return null;
            }

            using (FileStream stream = new FileStream(filePath, FileMode.Open, FileAccess.Read))
            using (BinaryReader reader = new BinaryReader(stream))
            {
                PlyFormat format = PlyFormat.Ascii;
                List<PlyElement> elements = new List<PlyElement>();

                string header = ReadHeader(reader, out format);
                ParseHeader(header, elements);

                PlyElement vertexElement = elements.Find(e => e.Name == "vertex");
                if (vertexElement == null)
                {
                    Debug.LogError("PLY file does not contain vertex element");
                    return null;
                }

                int vertexCount = vertexElement.Count;
                PointCloudData data = new PointCloudData(vertexCount);

                if (format == PlyFormat.Ascii)
                {
                    ReadAsciiVertices(reader, vertexElement, data);
                }
                else
                {
                    ReadBinaryVertices(reader, vertexElement, data, format == PlyFormat.BigEndian);
                }

                return data;
            }
        }

        private string ReadHeader(BinaryReader reader, out PlyFormat format)
        {
            format = PlyFormat.Ascii;
            StringBuilder header = new StringBuilder();
            string line;

            while ((line = ReadLine(reader)) != null)
            {
                header.AppendLine(line);

                if (line.StartsWith("format"))
                {
                    string[] parts = line.Split(' ');
                    if (parts.Length >= 2)
                    {
                        switch (parts[1])
                        {
                            case "ascii":
                                format = PlyFormat.Ascii;
                                break;
                            case "binary_little_endian":
                                format = PlyFormat.BinaryLittleEndian;
                                break;
                            case "binary_big_endian":
                                format = PlyFormat.BinaryBigEndian;
                                break;
                        }
                    }
                }

                if (line == "end_header")
                {
                    break;
                }
            }

            return header.ToString();
        }

        private string ReadLine(BinaryReader reader)
        {
            List<byte> bytes = new List<byte>();
            byte b;

            while (reader.BaseStream.Position < reader.BaseStream.Length)
            {
                b = reader.ReadByte();
                if (b == '\n')
                {
                    break;
                }
                if (b != '\r')
                {
                    bytes.Add(b);
                }
            }

            if (bytes.Count == 0 && reader.BaseStream.Position >= reader.BaseStream.Length)
            {
                return null;
            }

            return Encoding.ASCII.GetString(bytes.ToArray());
        }

        private void ParseHeader(string header, List<PlyElement> elements)
        {
            StringReader reader = new StringReader(header);
            string line;
            PlyElement currentElement = null;

            while ((line = reader.ReadLine()) != null)
            {
                line = line.Trim();
                if (string.IsNullOrEmpty(line) || line == "ply" || line == "end_header" || line.StartsWith("comment") || line.StartsWith("format") || line.StartsWith("obj_info"))
                {
                    continue;
                }

                if (line.StartsWith("element"))
                {
                    string[] parts = line.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length >= 3)
                    {
                        currentElement = new PlyElement
                        {
                            Name = parts[1],
                            Count = int.Parse(parts[2])
                        };
                        elements.Add(currentElement);
                    }
                }
                else if (line.StartsWith("property") && currentElement != null)
                {
                    PlyProperty property = new PlyProperty();
                    string[] parts = line.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);

                    if (parts.Length >= 3 && parts[1] == "list")
                    {
                        property.IsList = true;
                        property.ListCountType = parts[2];
                        property.Type = parts[3];
                        property.Name = parts[4];
                    }
                    else if (parts.Length >= 3)
                    {
                        property.Type = parts[1];
                        property.Name = parts[2];
                    }

                    currentElement.Properties.Add(property);
                }
            }
        }

        private void ReadAsciiVertices(BinaryReader reader, PlyElement vertexElement, PointCloudData data)
        {
            StreamReader textReader = new StreamReader(reader.BaseStream, Encoding.ASCII);
            char[] whitespace = new[] { ' ', '\t' };

            for (int i = 0; i < vertexElement.Count; i++)
            {
                string line = textReader.ReadLine();
                if (string.IsNullOrEmpty(line))
                    continue;

                string[] parts = line.Split(whitespace, StringSplitOptions.RemoveEmptyEntries);
                int partIndex = 0;

                float x = 0, y = 0, z = 0;
                byte r = 255, g = 255, b = 255;

                foreach (var prop in vertexElement.Properties)
                {
                    if (partIndex >= parts.Length)
                        break;

                    switch (prop.Name)
                    {
                        case "x":
                            float.TryParse(parts[partIndex], out x);
                            break;
                        case "y":
                            float.TryParse(parts[partIndex], out y);
                            break;
                        case "z":
                            float.TryParse(parts[partIndex], out z);
                            break;
                        case "red":
                        case "r":
                            byte.TryParse(parts[partIndex], out r);
                            break;
                        case "green":
                        case "g":
                            byte.TryParse(parts[partIndex], out g);
                            break;
                        case "blue":
                        case "b":
                            byte.TryParse(parts[partIndex], out b);
                            break;
                    }
                    partIndex++;
                }

                data.Vertices[i] = new Vector3(x, y, z);
                data.Colors[i] = ColorExtensions.FromRGB255(r, g, b);
            }
        }

        private void ReadBinaryVertices(BinaryReader reader, PlyElement vertexElement, PointCloudData data, bool isBigEndian)
        {
            for (int i = 0; i < vertexElement.Count; i++)
            {
                float x = 0, y = 0, z = 0;
                byte r = 255, g = 255, b = 255;

                foreach (var prop in vertexElement.Properties)
                {
                    switch (prop.Name)
                    {
                        case "x":
                            x = ReadFloat(reader, prop.Type, isBigEndian);
                            break;
                        case "y":
                            y = ReadFloat(reader, prop.Type, isBigEndian);
                            break;
                        case "z":
                            z = ReadFloat(reader, prop.Type, isBigEndian);
                            break;
                        case "red":
                        case "r":
                            r = ReadByte(reader, prop.Type, isBigEndian);
                            break;
                        case "green":
                        case "g":
                            g = ReadByte(reader, prop.Type, isBigEndian);
                            break;
                        case "blue":
                        case "b":
                            b = ReadByte(reader, prop.Type, isBigEndian);
                            break;
                        default:
                            SkipProperty(reader, prop);
                            break;
                    }
                }

                data.Vertices[i] = new Vector3(x, y, z);
                data.Colors[i] = ColorExtensions.FromRGB255(r, g, b);
            }
        }

        private float ReadFloat(BinaryReader reader, string type, bool isBigEndian)
        {
            switch (type)
            {
                case "float":
                case "float32":
                    byte[] fBytes = reader.ReadBytes(4);
                    if (isBigEndian) Array.Reverse(fBytes);
                    return BitConverter.ToSingle(fBytes, 0);
                case "double":
                case "float64":
                    byte[] dBytes = reader.ReadBytes(8);
                    if (isBigEndian) Array.Reverse(dBytes);
                    return (float)BitConverter.ToDouble(dBytes, 0);
                case "int":
                case "int32":
                    byte[] iBytes = reader.ReadBytes(4);
                    if (isBigEndian) Array.Reverse(iBytes);
                    return BitConverter.ToInt32(iBytes, 0);
                default:
                    return reader.ReadSingle();
            }
        }

        private byte ReadByte(BinaryReader reader, string type, bool isBigEndian)
        {
            switch (type)
            {
                case "uchar":
                case "uint8":
                    return reader.ReadByte();
                case "ushort":
                case "uint16":
                    byte[] usBytes = reader.ReadBytes(2);
                    if (isBigEndian) Array.Reverse(usBytes);
                    return (byte)BitConverter.ToUInt16(usBytes, 0);
                case "uint":
                case "uint32":
                    byte[] uiBytes = reader.ReadBytes(4);
                    if (isBigEndian) Array.Reverse(uiBytes);
                    return (byte)BitConverter.ToUInt32(uiBytes, 0);
                default:
                    return reader.ReadByte();
            }
        }

        private void SkipProperty(BinaryReader reader, PlyProperty prop)
        {
            if (prop.IsList)
            {
                int count = 0;
                switch (prop.ListCountType)
                {
                    case "uchar":
                        count = reader.ReadByte();
                        break;
                    case "ushort":
                        count = reader.ReadUInt16();
                        break;
                    case "uint":
                        count = reader.ReadInt32();
                        break;
                }

                int typeSize = GetTypeSize(prop.Type);
                reader.ReadBytes(count * typeSize);
            }
            else
            {
                reader.ReadBytes(GetTypeSize(prop.Type));
            }
        }

        private int GetTypeSize(string type)
        {
            switch (type)
            {
                case "char":
                case "uchar":
                case "uint8":
                    return 1;
                case "short":
                case "ushort":
                case "int16":
                case "uint16":
                    return 2;
                case "int":
                case "uint":
                case "float":
                case "int32":
                case "uint32":
                case "float32":
                    return 4;
                case "double":
                case "float64":
                    return 8;
                default:
                    return 4;
            }
        }
    }
}
