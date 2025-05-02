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
