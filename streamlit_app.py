import streamlit as st
import google.generativeai as genai
import os

# --- Configuration ---

# 1. API Key (Use Streamlit Secrets for deployment)
try:
    GOOGLE_API_KEY = "AIzaSyAdubNkNMtRoQILIQAqOXIg59FZFxBaLnM"
    genai.configure(api_key=GOOGLE_API_KEY)
    api_key_configured = True
    st.sidebar.success("✅ API Key Loaded")
except KeyError:
    st.error("🔴 Error: GOOGLE_API_KEY secret not found. Please set it in your Streamlit Cloud app settings.")
    api_key_configured = False
except Exception as e:
    st.error(f"🔴 Error configuring Gemini API: {e}")
    api_key_configured = False

# 2. Model Name (Consider making this a secret or config)
#    Verify availability in Google AI documentation.
MODEL_NAME = st.secrets.get("GEMINI_MODEL_NAME", 'gemini-1.5-flash-latest') # Allow override via secrets

# --- Model Initialization (Cached) ---
@st.cache_resource # Cache the model resource
def load_model():
    """Loads the GenerativeModel."""
    if not api_key_configured:
        st.error("API Key not configured, cannot load model.")
        return None
    try:
        st.info(f"[*] Initializing Gemini model: {MODEL_NAME}...")
        model = genai.GenerativeModel(MODEL_NAME)
        st.info("[+] Model initialized successfully.")
        return model
    except Exception as e:
        st.error(f"🔴 FATAL ERROR: Failed to initialize Gemini model ({MODEL_NAME}): {e}")
        return None

model = load_model()

# --- Core Generation Logic Function ---
def call_gemini_api(prompt: str):
    """
    Calls the Gemini API with the provided prompt and returns the generated text.
    Raises exceptions on failure.
    """
    if not model:
        raise ValueError("Gemini model is not available.")
    if not prompt or not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("Invalid 'prompt'. Must be a non-empty string.")

    prompt = prompt.strip()
    st.info(f"[*] Calling Gemini API ({MODEL_NAME}) for prompt: '{prompt[:50]}...'")

    try:
        response = model.generate_content(prompt)

        # Handle potential safety blocks or lack of content
        if not response.parts:
             st.warning(f"Gemini API returned no parts. Feedback: {response.prompt_feedback}")
             block_reason = getattr(response.prompt_feedback, 'block_reason', None)
             if block_reason:
                 raise ValueError(f"Content generation blocked by API: {block_reason}")
             else:
                 raise RuntimeError("API returned an empty response without a specific block reason.")

        generated_text = response.text
        st.info("[+] Successfully generated content from Gemini.")
        return generated_text

    except Exception as e:
        st.error(f"Error during Gemini API call: {e}")
        # Re-raise the exception so the caller knows something went wrong
        raise RuntimeError(f"An error occurred while communicating with the Gemini API: {e}")


# --- Streamlit App Interface (Example of how to use the function) ---

st.title("Gemini API Runner")
st.markdown(f"This app uses the `{MODEL_NAME}` model.")

if not api_key_configured:
    st.warning("API Key not configured. Generation is disabled.")
elif not model:
    st.error("Model could not be loaded. Generation is disabled.")
else:
    st.success("Model loaded and ready.")

    st.subheader("Manual Test")
    user_prompt = st.text_area("Enter prompt here:")
    if st.button("Generate Manually"):
        if user_prompt:
            try:
                with st.spinner("Generating..."):
                    result = call_gemini_api(user_prompt)
                st.subheader("Result:")
                st.markdown(result)
            except Exception as e:
                st.error(f"Generation failed: {e}")
        else:
            st.warning("Please enter a prompt.")