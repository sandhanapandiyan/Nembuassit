from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import subprocess
import psycopg2
from psycopg2 import sql
from typing import Dict, List, Optional, Any
import os
import logging
from datetime import datetime
import re

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database configuration
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "168.220.245.22"),
    "database": os.getenv("DB_NAME", "Nembuassist"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "Cloud@2025"),
    "port": os.getenv("DB_PORT", "5432")
}

class QueryRequest(BaseModel):
    user_query: str
    previous_context: Optional[List[Dict]] = None

def get_db_connection():
    return psycopg2.connect(**DB_CONFIG)

def fetch_schema():
    """Fetch complete database schema"""
    schema_info = {}
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get all tables
        cursor.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        """)
        tables = [table[0] for table in cursor.fetchall()]
        
        for table in tables:
            # Get columns
            cursor.execute(sql.SQL("""
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = {}
            """).format(sql.Literal(table)))
            
            schema_info[table] = [
                {"column_name": col[0], "data_type": col[1]} 
                for col in cursor.fetchall()
            ]
            
            # Get foreign key relationships
            cursor.execute("""
                SELECT
                    kcu.column_name,
                    ccu.table_name AS foreign_table,
                    ccu.column_name AS foreign_column
                FROM 
                    information_schema.table_constraints AS tc 
                    JOIN information_schema.key_column_usage AS kcu
                      ON tc.constraint_name = kcu.constraint_name
                    JOIN information_schema.constraint_column_usage AS ccu
                      ON ccu.constraint_name = tc.constraint_name
                WHERE 
                    tc.constraint_type = 'FOREIGN KEY' AND 
                    tc.table_name = %s
            """, (table,))
            
            foreign_keys = cursor.fetchall()
            if foreign_keys:
                schema_info[table].append({"foreign_keys": foreign_keys})
        
        return schema_info
        
    except Exception as e:
        logger.error(f"Schema fetch error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    finally:
        if conn:
            conn.close()

@app.get("/schema")
async def get_schema():
    """Endpoint to fetch current database schema"""
    try:
        schema = fetch_schema()
        logger.info("Schema fetched successfully")
        return {
            "status": "success",
            "schema": schema
        }
    except Exception as e:
        logger.error(f"Schema endpoint error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch schema. Error: {str(e)}")

def format_schema_for_prompt(schema_info):
    """Convert schema dictionary to text format for LLM prompt"""
    prompt = []
    for table, columns in schema_info.items():
        prompt.append(f"Table: {table}")
        for col in columns:
            if isinstance(col, dict) and 'foreign_keys' not in col:
                prompt.append(f"- {col['column_name']} ({col['data_type']})")
            elif isinstance(col, dict) and 'foreign_keys' in col:
                for fk in col['foreign_keys']:
                    prompt.append(f"- FK: {fk[0]} references {fk[1]}.{fk[2]}")
        prompt.append("")  # Add empty line between tables
    return "\n".join(prompt)

def validate_foreign_keys(sql_query: str):
    """Validate foreign key constraints in the SQL query"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check for department references
        if "dept_id" in sql_query.lower():
            cursor.execute("SELECT dept_id FROM department")
            valid_dept_ids = [str(row[0]) for row in cursor.fetchall()]
            
            # Extract department IDs from the SQL
            dept_id_matches = re.findall(r"dept_id\s*=\s*(\d+)", sql_query, re.IGNORECASE)
            dept_id_matches += re.findall(r"VALUES\s*\(.*?(\d+)", sql_query, re.IGNORECASE)
            
            for dept_id in set(dept_id_matches):
                if dept_id not in valid_dept_ids:
                    raise ValueError(
                        f"Department ID {dept_id} does not exist. Valid IDs: {', '.join(valid_dept_ids)}"
                    )
        
        # Add validation for other foreign keys as needed
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if conn:
            conn.close()

def execute_sql_query(sql_query: str):
    """Execute SQL query and return results with metadata"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        start_time = datetime.now()
        cursor.execute(sql_query)
        execution_time = (datetime.now() - start_time).total_seconds()
        
        # For SELECT queries, return data
        if cursor.description:
            columns = [desc[0] for desc in cursor.description]
            data = cursor.fetchall()
            row_count = len(data)
            conn.commit()
            return {
                "type": "SELECT",
                "columns": columns,
                "data": data,
                "row_count": row_count,
                "execution_time": execution_time
            }
        # For other queries, return affected rows
        else:
            row_count = cursor.rowcount
            conn.commit()
            return {
                "type": "MODIFICATION",
                "row_count": row_count,
                "execution_time": execution_time,
                "message": "Query executed successfully"
            }
            
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Query execution failed: {str(e)}")
        raise
    finally:
        if conn:
            conn.close()

def get_next_prompt(table_name: str, current_values: Dict[str, any]) -> Optional[Dict[str, any]]:
    """Determine the next field to prompt for based on the table schema and current values."""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Fetch table schema
        cursor.execute("""
            SELECT column_name, data_type, is_nullable, character_maximum_length, column_default
            FROM information_schema.columns
            WHERE table_name = %s
            ORDER BY ordinal_position
        """, (table_name,))

        fields = cursor.fetchall()

        # Identify the next field to prompt for
        for field in fields:
            column_name, data_type, is_nullable, max_length, column_default = field

            # Skip fields that already have values
            if column_name in current_values:
                continue

            # Handle foreign key references
            cursor.execute("""
                SELECT 
                    ccu.table_name AS foreign_table,
                    ccu.column_name AS foreign_column
                FROM 
                    information_schema.table_constraints AS tc 
                    JOIN information_schema.key_column_usage AS kcu
                      ON tc.constraint_name = kcu.constraint_name
                    JOIN information_schema.constraint_column_usage AS ccu
                      ON ccu.constraint_name = tc.constraint_name
                WHERE 
                    tc.constraint_type = 'FOREIGN KEY' AND 
                    tc.table_name = %s AND 
                    kcu.column_name = %s
            """, (table_name, column_name))
            foreign_key = cursor.fetchone()
            if foreign_key:
                foreign_table, foreign_column = foreign_key
                cursor.execute(sql.SQL("SELECT {}, {} FROM {} ORDER BY {} ASC").format(
                    sql.Identifier(foreign_column),
                    sql.Identifier('department_name' if foreign_table == 'department' else 'name'),
                    sql.Identifier(foreign_table),
                    sql.Identifier('department_name' if foreign_table == 'department' else 'name')
                ))
                options = cursor.fetchall()
                return {
                    "field_name": column_name,
                    "field_type": "select",
                    "prompt": f"Please select a value for {column_name.replace('_', ' ')}",
                    "options": [{"id": row[0], "name": row[1]} for row in options]
                }

            # Prepare the prompt details for non-foreign key fields
            prompt = {
                "field_name": column_name,
                "field_type": data_type,
                "prompt": f"Please provide a value for {column_name.replace('_', ' ')}",
                "max_length": max_length
            }

            if data_type == 'character varying' and max_length:
                prompt["prompt"] += f" (max {max_length} characters)"
            elif data_type == 'date':
                prompt["prompt"] += " (format: YYYY-MM-DD)"
            elif data_type in ('integer', 'numeric'):
                prompt["prompt"] += " (numeric value)"

            return prompt

        # No more fields to prompt for
        return None

    except Exception as e:
        logger.error(f"Error in get_next_prompt: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to determine the next prompt.")
    finally:
        if conn:
            conn.close()

# Enhanced error handling and logging for stability

@app.post("/query")
async def handle_query(request: Request, query_request: QueryRequest):
    """Main endpoint that handles both generation and execution"""
    try:
        # Log the incoming request body for debugging
        body = await request.json()
        logger.info(f"Received request body: {body}")

        user_query = query_request.user_query.lower()

        # Check for insert operations
        insert_patterns = {
            "employee": r"add\s+(?:new\s+)?employee|create\s+(?:new\s+)?employee",
            "department": r"add\s+(?:new\s+)?department|create\s+(?:new\s+)?department"
        }

        for table, pattern in insert_patterns.items():
            if re.search(pattern, user_query):
                # Start insert conversation
                next_prompt = get_next_prompt(table, {})
                if next_prompt:
                    logger.info(f"Starting insert operation for table: {table}")
                    return {
                        "status": "incomplete",
                        "conversation_id": f"conv-{datetime.now().timestamp()}",
                        "table_name": table,
                        "voice_message": f"Let's add a new {table}. I'll help you fill in the details.",
                        "next_prompt": next_prompt
                    }
                else:
                    logger.warning(f"No fields to collect for table: {table}")
                    return {
                        "status": "error",
                        "message": f"No fields to collect for {table}."
                    }

        # If not an insert operation, continue with normal query handling
        logger.info(f"Processing regular query: {query_request.user_query}")

        # Get schema
        schema_info = fetch_schema()
        schema_prompt = format_schema_for_prompt(schema_info)

        # Prepare the prompt with explicit constraints
        prompt = f"""
        Database Schema:
        {schema_prompt}

        Important Constraints:
        - All foreign key references must exist in their respective tables
        - Never invent ID values - use only existing IDs
        - For department IDs, verify they exist in department table first

        Task: Convert this to valid PostgreSQL: {query_request.user_query}

        Requirements:
        - Return ONLY the SQL query without any explanations
        - Must respect all database constraints
        - Use proper syntax for the operation type
        - Include all necessary clauses

        SQL Query:
        """

        # Generate SQL with proper encoding handling
        logger.info("Generating SQL...")
        result = subprocess.run(
            ["ollama", "run", "SqlGenerator", prompt],
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            check=True
        )

        # Process the generated SQL
        sql_query = result.stdout.strip()
        if "```sql" in sql_query:
            sql_query = sql_query.split("```sql")[1].split("```")[0].strip()
        elif "```" in sql_query:
            sql_query = sql_query.split("```"[1]).split("```"[0]).strip()
        

        logger.info(f"Generated SQL: {sql_query}")

        # Validate the SQL before execution
        validate_foreign_keys(sql_query)

        # Execute the query
        logger.info("Executing query...")
        execution_result = execute_sql_query(sql_query)
        logger.info(f"Execution result: {execution_result}")

        return {
            "status": "success",
            "generated_query": sql_query,
            "execution_result": execution_result,
            "schema": schema_info,
            "timestamp": datetime.now().isoformat()
        }

    except HTTPException as e:
        logger.error(f"Validation error: {e.detail}")
        raise
    except subprocess.CalledProcessError as e:
        logger.error(f"SQL generation failed: {e.stderr}")
        raise HTTPException(status_code=500, detail="SQL generation failed")
    except Exception as e:
        logger.error(f"Query handling failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

class FieldPromptsRequest(BaseModel):
    table_name: str
    conversation_id: str
    current_values: Optional[Dict[str, Any]] = None

    class Config:
        arbitrary_types_allowed = True

# Add a global dictionary to track conversation states
conversation_states = {}

@app.post("/field-prompts")
async def get_field_prompts(request: FieldPromptsRequest):
    """Get the next field prompt for a table based on the current state."""
    try:
        table_name = request.table_name
        conversation_id = request.conversation_id
        current_values = request.current_values or {}

        # Check if we already have this field in current_values
        if current_values:
            # Get existing field names
            existing_fields = current_values.keys()
            logger.info(f"Existing fields for {table_name}: {existing_fields}")

        # Fetch the next field to prompt for
        next_prompt = get_next_prompt(table_name, current_values)

        if not next_prompt:
            # No more fields to prompt for
            return {
                "status": "complete",
                "message": f"All fields collected for {table_name}.",
                "collected_values": current_values
            }

        # Skip if we already have this field
        if next_prompt["field_name"] in current_values:
            logger.info(f"Skipping already collected field: {next_prompt['field_name']}")
            return {
                "status": "complete",
                "message": f"All required fields collected for {table_name}.",
                "collected_values": current_values
            }

        # Update conversation state
        conversation_states[conversation_id] = {
            "table_name": table_name,
            "current_values": current_values
        }

        return {
            "status": "incomplete",
            "next_prompt": next_prompt
        }

    except Exception as e:
        logger.error(f"Error in get_field_prompts: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch the next field prompt.")

@app.post("/finalize")
async def finalize_insert(conversation_id: str):
    """Finalize the insert operation by executing the query."""
    state = conversation_states.get(conversation_id)
    if not state:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    table_name = state["table_name"]
    field_values = state["current_values"]

    # Build and execute the INSERT query
    try:
        columns = list(field_values.keys())
        values = list(field_values.values())

        query = sql.SQL("INSERT INTO {} ({}) VALUES ({}) RETURNING *").format(
            sql.Identifier(table_name),
            sql.SQL(", ").join(map(sql.Identifier, columns)),
            sql.SQL(", ").join(sql.Placeholder() * len(columns))
        )

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(query, values)
        result = cursor.fetchone()
        conn.commit()

        # Clear the conversation state
        del conversation_states[conversation_id]

        return {
            "status": "success",
            "message": f"Successfully inserted into {table_name}.",
            "data": dict(zip([desc[0] for desc in cursor.description], result))
        }
    except Exception as e:
        logger.error(f"Insert query execution failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to execute the insert query.")

# API endpoints
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        conn = get_db_connection()
        conn.close()
        return {"status": "healthy", "message": "Service is running"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/schema")
async def get_schema():
    """Get database schema"""
    try:
        schema = fetch_schema()
        return {"status": "success", "schema": schema}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
async def health_check():
    return {"status": "ok", "message": "SQL Generator API is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)