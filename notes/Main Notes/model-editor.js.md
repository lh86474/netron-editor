2026-06-08

Tags: [[ambarella]] [[netron]]
## model-editor.js

### Notes

Defines utility functions and classes **used to manipulate and manage a structured data model**

This JavaScript code defines several utility functions and classes for manipulating and managing a structured data model, likely used in a visual programming or node-based editor environment.

Here's a breakdown of the key components:

1. Data Transformation and Reading Functions:

   readType(type): This function processes a type object, extracting specific properties like name, identifier, category, module, and version. It also handles attributes by mapping them to a new structure with name, type, default, and required properties. This is likely used to normalize type definitions.
   
   normalizeScalar(value): This function handles scalar values. If a bigint is within the safe integer range for JavaScript numbers, it converts it to a Number; otherwise, it converts it to a string. Other types are returned as is.
   
   cloneAttributeValue(value): This function clones attribute values. If the value is an array, it maps over each item, normalizing scalars. Otherwise, it normalizes the single scalar value.
   stringifyEditorJSON(value): A custom JSON stringifier that converts bigint values to their string representation before serialization. This is crucial for environments that don't natively support bigint in JSON.
   
   trackArgumentValues(argument, track): Iterates through the value array of an argument and calls a track function for each value. This is used for collecting and identifying unique values.
   
   enumerateGraphValues(graph, graphIndex): This function traverses a graph object (containing inputs, outputs, and nodes) and its arguments. It collects all unique values encountered and maps them to unique identifiers in the format graph:graphIndex/value:index. It uses a Map to store these mappings and the track function to add values.
   
   readModel(model): This is a core function that takes a raw model object and transforms it into a more structured and potentially normalized format. It uses helper functions (cloneValue, readArgumentValues, readArgument, readAttribute, readNode, readGraph) to recursively process the model's components, ensuring consistent data structures and handling bigint serialization.
   
   parseNodeEntityId(entityId) and parseValueEntityId(entityId): These functions parse string identifiers (entity IDs) that represent specific locations within the model (nodes, attributes, or values) and return their corresponding indices and graph information.
   
   attributeNameFromProperty(property): Extracts an attribute name from a property string that is expected to start with "attributes.".
   
   getValueByEntityId(model, entityId): Retrieves a specific value from the model given its entityId. It uses parseValueEntityId and enumerateGraphValues to locate the value.
   
   buildOriginalSnapshot(model): Creates a snapshot of the model's initial state. It iterates through nodes, attributes, and values, storing their names and values in a Map keyed by their entity IDs. This is likely used for change tracking.

2. Helper Objects and Classes:

   AttributeSchemaResolver: An object containing static methods for dealing with attribute schemas:
       lookup(nodeType, attributeName): Finds an attribute schema definition within a node's type.
	   
       resolveType(nodeType, attributeName): Determines the data type of an attribute based on its schema, defaulting to 'string'.
	   
       validateName(node, attributeName, excludeIndex): Checks if an attribute name is valid and unique within a node.
	   
       parseValue(text, type): Parses a string input into a value of a specified type, handling array types and various numeric types.
	   
   EditableModel: A class that wraps a model object, providing methods to access and manage its components:
       constructor(model): Initializes with a model.
       model: Getter for the underlying model.
       getGraph(graphIndex): Returns a specific graph from the model.
   EditorState: This class manages the state of an editable model, including tracking changes:
       constructor(original): Initializes with an original model, creates a normalized EditableModel, builds an initial snapshot, and initializes a DeltaTracker.
       original: Getter for the original, unedited model.
       applyPatch(patch): Applies changes (patches) to the EditableModel. It handles various patch types (add, delete, update) for attributes, nodes, and values, updating the EditableModel and recording the changes in the DeltaTracker. It also constructs a change object representing the applied patch.

3. Exported Utility Functions:

   locateNodeEntity(model, node): Finds the location (graph index and node index) of a given node object within the model.
   locateValueEntity(model, value): Finds the location (graph index and value ID) of a given value object within the model.
   ModelEditor: A static class providing methods for creating and managing editable model sessions:
       createSession(model): Creates a new EditorState instance for editing a model.
       cloneFrom(model): Creates a new EditableModel instance by deeply cloning and normalizing a given model.



