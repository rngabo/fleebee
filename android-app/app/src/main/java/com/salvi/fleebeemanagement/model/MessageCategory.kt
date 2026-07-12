package com.salvi.fleebeemanagement.model

enum class MessageCategory(
    val displayName: String,
    val shortDescription: String
) {
    REMINDER(
        displayName = "Reminder",
        shortDescription = "Payment follow-up"
    ),
    GENERAL(
        displayName = "General information",
        shortDescription = "Safety and conduct updates"
    ),
    EMERGENCY(
        displayName = "Emergency",
        shortDescription = "Urgent traffic or incident response"
    );

    fun buildSuggestedMessage(biker: Biker): String {
        return when (this) {
            REMINDER -> "Hello ${biker.name}, this is a reminder to complete your scheduled payment. Please follow up today. Thank you."
            GENERAL -> "Hello ${biker.name}, please drive safely, respect road rules, and maintain good conduct while working today."
            EMERGENCY -> "Hello ${biker.name}, please contact me immediately regarding an urgent traffic issue linked to your bike."
        }
    }

    companion object {
        fun fromName(value: String?): MessageCategory {
            return entries.firstOrNull { it.name == value } ?: REMINDER
        }
    }
}
