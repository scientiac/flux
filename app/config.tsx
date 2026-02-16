import axios from 'axios';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Chip, Divider, HelperText, List, Text, TextInput, useTheme } from 'react-native-paper';
import { useAppContext } from '../context/AppContext';

export default function Config() {
    const { config, updateConfig } = useAppContext();
    const theme = useTheme();
    const router = useRouter();

    const [contentDir, setContentDir] = useState(config.contentDir);
    const [assetsDir, setAssetsDir] = useState(config.assetsDir);
    const [isValidating, setIsValidating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [missingDir, setMissingDir] = useState<string | null>(null);

    const validatePath = async (token: string, path: string) => {
        try {
            await axios.get(`https://api.github.com/repos/${config.repo}/contents/${path}`, {
                headers: { Authorization: `token ${token}` }
            });
            return true;
        } catch (e: any) {
            if (e.response?.status === 404) return false;
            throw e;
        }
    };

    const createPlaceholder = async (token: string, path: string) => {
        const message = 'Initial directory setup';
        const content = Buffer.from('placeholder').toString('base64');
        await axios.put(`https://api.github.com/repos/${config.repo}/contents/${path}/.gitkeep`, {
            message,
            content
        }, {
            headers: { Authorization: `token ${token}` }
        });
    };

    const handleConfirm = async () => {
        setIsValidating(true);
        setError(null);
        setMissingDir(null);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            if (!token) throw new Error('Authentication lost. Please log in again.');

            const contentValid = await validatePath(token, contentDir);
            if (!contentValid) {
                setMissingDir(contentDir);
                throw new Error(`Content directory ${contentDir} does not exist.`);
            }

            const assetsValid = await validatePath(token, assetsDir);
            if (!assetsValid) {
                setMissingDir(assetsDir);
                throw new Error(`Assets directory ${assetsDir} does not exist.`);
            }

            await updateConfig({ contentDir, assetsDir });
            router.push('/files');
        } catch (e: any) {
            console.error('[Config] Validation failed', e);
            setError(e.message || 'Validation failed');
        } finally {
            setIsValidating(false);
        }
    };

    const handleCreateMissing = async () => {
        if (!missingDir) return;
        setIsValidating(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            if (!token) throw new Error('Not authenticated');

            await createPlaceholder(token, missingDir);
            setError(null);
            setMissingDir(null);
            // Re-validate after creation
            await handleConfirm();
        } catch (e: any) {
            setError(`Failed to create directory: ${e.message}`);
        } finally {
            setIsValidating(false);
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header elevated style={{ backgroundColor: theme.colors.surface }}>
                <Appbar.BackAction onPress={() => router.back()} />
                <Appbar.Content title="Setup Workspace" />
            </Appbar.Header>

            <ScrollView contentContainerStyle={styles.scroll}>
                <View style={styles.header}>
                    <Text variant="headlineSmall" style={styles.title}>Configure Paths</Text>
                    <Text variant="bodyMedium" style={styles.subtitle}>
                        Define where your posts and images are stored in {config.repo}
                    </Text>
                </View>

                <List.Section>
                    <TextInput
                        label="Content Directory"
                        value={contentDir}
                        onChangeText={setContentDir}
                        mode="outlined"
                        placeholder="e.g. content/posts"
                        style={styles.input}
                        left={<TextInput.Icon icon="folder" />}
                    />
                    <HelperText type="info">Where your .md files are located</HelperText>
                    <View style={styles.chipRow}>
                        <Chip style={styles.chip} onPress={() => setContentDir('content')}>content/</Chip>
                        <Chip style={styles.chip} onPress={() => setContentDir('content/posts')}>content/posts/</Chip>
                        <Chip style={styles.chip} onPress={() => setContentDir('posts')}>posts/</Chip>
                    </View>

                    <Divider style={styles.divider} />

                    <TextInput
                        label="Assets Directory"
                        value={assetsDir}
                        onChangeText={setAssetsDir}
                        mode="outlined"
                        placeholder="e.g. static/assets"
                        style={styles.input}
                        left={<TextInput.Icon icon="image-multiple" />}
                    />
                    <HelperText type="info">Where your images/media are stored</HelperText>
                    <View style={styles.chipRow}>
                        <Chip style={styles.chip} onPress={() => setAssetsDir('static/assets')}>static/assets/</Chip>
                        <Chip style={styles.chip} onPress={() => setAssetsDir('static/images')}>static/images/</Chip>
                        <Chip style={styles.chip} onPress={() => setAssetsDir('assets')}>assets/</Chip>
                    </View>
                </List.Section>

                <View style={styles.footer}>
                    {error && (
                        <View style={styles.errorBox}>
                            <Text style={{ color: theme.colors.error }}>{error}</Text>
                            {missingDir && (
                                <Button
                                    mode="text"
                                    onPress={handleCreateMissing}
                                    loading={isValidating}
                                    style={{ marginTop: 8 }}
                                >
                                    Create '{missingDir}'
                                </Button>
                            )}
                        </View>
                    )}

                    <Button
                        mode="contained"
                        onPress={handleConfirm}
                        loading={isValidating}
                        disabled={isValidating}
                        style={styles.confirmButton}
                        contentStyle={styles.confirmButtonContent}
                    >
                        Confirm and Start Posting
                    </Button>
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scroll: { padding: 24, paddingBottom: 48 },
    header: { marginBottom: 32 },
    title: { fontWeight: 'bold' },
    subtitle: { opacity: 0.7, marginTop: 8 },
    input: { backgroundColor: 'transparent' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -8, marginBottom: 16 },
    chip: { backgroundColor: 'transparent' },
    divider: { marginVertical: 16 },
    footer: { marginTop: 32 },
    errorBox: {
        padding: 16,
        backgroundColor: 'rgba(186, 26, 26, 0.05)',
        borderRadius: 12,
        marginBottom: 24,
        alignItems: 'center'
    },
    confirmButton: { borderRadius: 28 },
    confirmButtonContent: { height: 56 }
});
